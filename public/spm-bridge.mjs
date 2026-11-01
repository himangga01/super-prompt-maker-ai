#!/usr/bin/env node
// Super Prompt Maker - AI CLI bridge.
// Runs on the visitor's own PC so prompt generation uses *their* Claude / Codex / Gemini CLI account.
// Usage: node spm-bridge.mjs --server http://<host>:3000 --code <PAIR-CODE>
// The bridge only ever runs the three whitelisted CLIs with fixed arguments; prompts go through stdin.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, access, constants } from 'node:fs/promises';
import { tmpdir, hostname, platform } from 'node:os';
import { join, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROVIDERS = ['claude', 'codex', 'gemini'];
const MODEL_RE = /^[\w.\-:\[\]]{1,64}$/;
const isWin = process.platform === 'win32';

// Walk PATH ourselves: `where.exe` prints in the OEM codepage and mangles non-ASCII user folders.
async function resolveCommand(name) {
  const dirs = (process.env.PATH || process.env.Path || '').split(delimiter).map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  // Prefer .exe, then .cmd; bare npm shims without extension can't be spawned directly on Windows.
  const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
  for (const ext of exts) {
    for (const dir of dirs) {
      const file = join(dir, name + ext);
      try { await access(file, isWin ? constants.F_OK : constants.X_OK); return file; } catch { /* keep looking */ }
    }
  }
  return null;
}

function quoteWin(arg) {
  if (arg === '') return '""';
  return /[\s"&|<>^%]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

// When this process was itself launched from a Claude Code session, its session variables would
// make the child `claude` reuse that session's auth instead of the user's own CLI login.
function cliEnv() {
  if (!process.env.CLAUDECODE) return process.env;
  return Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW|USE_LOCAL_OAUTH|USE_STAGING_OAUTH|ANTHROPIC_BASE_URL)/.test(k)));
}

// 3 full prompts measured up to ~170s with several runs in parallel; leave headroom.
function run(cmdPath, args, { input = '', cwd, timeoutMs = 360000 } = {}) {
  return new Promise((resolve) => {
    const viaShell = isWin && /\.(cmd|bat)$/i.test(cmdPath);
    const env = cliEnv();
    const child = viaShell
      ? spawn([quoteWin(cmdPath), ...args.map(quoteWin)].join(' '), { cwd, env, shell: true, windowsHide: true })
      : spawn(cmdPath, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    // On Windows, kill the whole tree: killing the cmd.exe wrapper alone leaves the CLI running.
    const timer = setTimeout(() => {
      timedOut = true;
      if (isWin && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e.message || e), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function detectClis() {
  const out = {};
  await Promise.all(PROVIDERS.map(async (p) => {
    const path = await resolveCommand(p);
    if (!path) { out[p] = { available: false }; return; }
    const r = await run(path, ['--version'], { timeoutMs: 15000 });
    const version = (r.stdout || r.stderr).trim().split(/\r?\n/)[0]?.slice(0, 80) || '';
    out[p] = { available: r.code === 0, version };
  }));
  return out;
}

export async function runCli(provider, prompt, { model, timeoutMs } = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error(`지원하지 않는 CLI: ${provider}`);
  if (model && !MODEL_RE.test(model)) throw new Error('잘못된 모델 이름');
  const cmd = await resolveCommand(provider);
  if (!cmd) throw new Error(`${provider} CLI를 찾을 수 없습니다. 설치 및 로그인 후 다시 시도하세요.`);
  // Empty scratch dir so the CLI never sees project files.
  const cwd = await mkdtemp(join(tmpdir(), 'spm-'));
  try {
    let args;
    let outFile;
    if (provider === 'claude') {
      // Text-only: no tools, no MCP servers, no saved session.
      args = ['-p', '--output-format', 'text', '--no-session-persistence', '--strict-mcp-config', '--tools', ''];
      if (model) args.push('--model', model);
    } else if (provider === 'codex') {
      outFile = join(cwd, 'last-message.txt');
      // Prompt writing doesn't need deep reasoning; medium effort keeps a 3-prompt run under a minute or so.
      args = ['exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '--color', 'never', '-c', 'model_reasoning_effort=medium', '-o', outFile];
      if (model) args.push('-m', model);
      args.push('-');
    } else {
      args = [];
      if (model) args.push('-m', model);
    }
    const r = await run(cmd, args, { input: prompt, cwd, timeoutMs });
    if (r.timedOut) throw new Error(`${provider} 응답 시간이 초과되었습니다.`);
    let text = r.stdout;
    if (outFile) text = await readFile(outFile, 'utf8').catch(() => r.stdout);
    if (r.code !== 0 || !text.trim()) {
      const detail = (r.stderr.trim() || r.stdout.trim()).slice(-600);
      throw new Error(`${provider} 실행 실패 (code ${r.code}): ${detail || '로그인 상태를 확인하세요.'}`);
    }
    return text.trim();
  } finally {
    rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------- bridge client ----------------
function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function api(server, path, { method = 'GET', token, body } = {}) {
  const res = await fetch(new URL(path, server), {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    // Long-poll holds 25s server-side; anything much longer is a dead connection.
    signal: AbortSignal.timeout(45000),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

async function main() {
  const server = argValue('server');
  const code = argValue('code');
  if (!server || !code) {
    console.log('사용법: node spm-bridge.mjs --server http://<서버주소>:3000 --code <연결코드>');
    process.exit(1);
  }
  console.log('🔎 이 PC의 AI CLI를 확인하는 중...');
  const clis = await detectClis();
  for (const p of PROVIDERS) console.log(`   ${clis[p].available ? '✅' : '❌'} ${p} ${clis[p].version || ''}`);
  if (!PROVIDERS.some((p) => clis[p].available)) console.log('⚠️  사용 가능한 CLI가 없습니다. claude / codex / gemini 중 하나를 설치하고 로그인하세요.');

  const { token } = await api(server, '/api/bridge/pair', {
    method: 'POST',
    body: { code: code.trim().toUpperCase(), clis, hostname: hostname(), platform: platform() },
  });
  console.log(`🔗 연결 완료: ${server}  (브라우저로 돌아가 프롬프트를 생성하세요 · 종료: Ctrl+C)`);

  let backoff = 1000;
  for (;;) {
    try {
      const job = await api(server, '/api/bridge/poll', { token });
      backoff = 1000;
      if (!job) continue;
      console.log(`▶ ${new Date().toLocaleTimeString()} ${job.provider}로 프롬프트 생성 중...`);
      try {
        const output = await runCli(job.provider, job.prompt, { model: job.model });
        await api(server, '/api/bridge/result', { method: 'POST', token, body: { jobId: job.id, ok: true, output } });
        console.log('  ✔ 완료');
      } catch (e) {
        await api(server, '/api/bridge/result', { method: 'POST', token, body: { jobId: job.id, ok: false, error: e.message } });
        console.log(`  ✖ ${e.message}`);
      }
    } catch (e) {
      if (e.status === 401) { console.log('⛔ 연결이 해제되었습니다. 브라우저에서 새 연결 코드를 받아 다시 실행하세요.'); process.exit(1); }
      console.log(`… 서버 연결 재시도 (${e.message})`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 15000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
