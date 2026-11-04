#!/usr/bin/env node
// Super Prompt Maker - AI CLI bridge.
// Runs on the visitor's own PC so prompt generation uses *their* Claude / Codex / Gemini CLI account.
// Usage: node spm-bridge.mjs --server http://<host>:3000 --code <PAIR-CODE>
// The bridge only ever runs the three whitelisted CLIs with fixed arguments; prompts go through stdin.
import { spawn } from 'node:child_process';
import { constants, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir, hostname, platform } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROVIDERS = ['claude', 'codex', 'gemini'];
// No leading "-", so a model name can never be read as a CLI option.
export const MODEL_RE = /^(?!-)[\w.\-:\[\]]{1,64}$/;
// Timing shared with server.mjs, which derives its own limits from these.
export const CLI_TIMEOUT_MS = 360000; // 3 full prompts measured up to ~170s with several runs in parallel
export const HEARTBEAT_MS = 20000; // bridge -> server while a CLI runs
export const FETCH_TIMEOUT_MS = 45000; // longer than the server's 25s poll hold; anything longer is a dead connection
// Codex tools that could act on the visitor's PC. Prompt writing needs none of them, so Codex runs text-only.
const CODEX_DISABLED = ['shell_tool', 'unified_exec', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'apps'];
const isWin = process.platform === 'win32';

// Walk PATH ourselves: `where.exe` prints in the OEM codepage and mangles non-ASCII user folders.
// Folder order wins (like the shell); within a folder prefer .exe, then .cmd/.bat npm shims.
async function resolveCommand(name) {
  const dirs = (process.env.PATH || process.env.Path || '').split(delimiter).map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  const exts = isWin ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
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
export function cliEnv(extra = {}) {
  const env = !process.env.CLAUDECODE ? process.env : Object.fromEntries(Object.entries(process.env).filter(([k]) =>
    !/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW|USE_LOCAL_OAUTH|USE_STAGING_OAUTH|ANTHROPIC_BASE_URL)/.test(k)));
  return { ...env, ...extra };
}

// Children still running, so Ctrl+C on the bridge/server can take them down too.
const active = new Set();

function killTree(child, signal = 'SIGTERM') {
  if (!child.pid) return;
  // Windows: killing the cmd.exe wrapper alone leaves the CLI running, so kill the whole tree.
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  // POSIX: children run in their own process group (detached), so signal the group.
  else try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
}

if (!isWin) {
  // Detached groups don't get the terminal's signals, so pass them on (SIGHUP: the terminal window closed).
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { for (const c of active) killTree(c, 'SIGKILL'); process.exit(130); });
  }
  process.on('exit', () => { for (const c of active) killTree(c, 'SIGKILL'); });
}

function run(cmdPath, args, { input = '', cwd, timeoutMs = CLI_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve) => {
    const viaShell = isWin && /\.(cmd|bat)$/i.test(cmdPath);
    const opts = { cwd, env: cliEnv(env), windowsHide: true, detached: !isWin };
    const child = viaShell
      ? spawn([quoteWin(cmdPath), ...args.map(quoteWin)].join(' '), { ...opts, shell: true })
      : spawn(cmdPath, args, opts);
    active.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let hardKill;
    const done = (code, err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(hardKill);
      active.delete(child);
      resolve({ code, stdout, stderr: err ?? stderr, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
      // A CLI that ignores SIGTERM (or a grandchild holding the pipe) must not hang the caller.
      hardKill = setTimeout(() => { killTree(child, 'SIGKILL'); done(null); }, 5000);
    }, timeoutMs);
    // Decode as one UTF-8 stream: a Korean character split across chunks must not become U+FFFD.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => done(-1, String(e.message || e)));
    child.on('close', (code) => done(code));
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

function argsFor(provider, { model, outFile, isolate = true } = {}) {
  if (provider === 'claude') {
    // Text-only: no tools, no MCP servers, no saved session. Safe mode also skips the visitor's
    // hooks, plugins, skills and CLAUDE.md, so personal setup can't run code or bend the JSON reply.
    const args = ['-p', '--output-format', 'text', '--no-session-persistence', '--strict-mcp-config', '--tools', ''];
    if (isolate) args.push('--safe-mode');
    if (model) args.push('--model', model);
    return args;
  }
  if (provider === 'codex') {
    // --ignore-user-config skips the visitor's config.toml (MCP servers, hooks, profiles; login still works),
    // and the --disable switches remove the shell and browser tools, so a prompt can't make Codex read files.
    // Prompt writing doesn't need deep reasoning; medium effort keeps a 3-prompt run under a minute or so.
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '--color', 'never',
      '-c', 'model_reasoning_effort=medium', ...CODEX_DISABLED.flatMap((f) => ['--disable', f]), '-o', outFile];
    if (model) args.push('-m', model);
    args.push('-');
    return args;
  }
  // Gemini reads the prompt from piped stdin in headless mode, where tool approvals are denied.
  return model ? ['-m', model] : [];
}

export async function runCli(provider, prompt, { model, timeoutMs } = {}) {
  if (!PROVIDERS.includes(provider)) throw new Error(`지원하지 않는 CLI: ${provider}`);
  if (model && !MODEL_RE.test(model)) throw new Error('잘못된 모델 이름');
  const cmd = await resolveCommand(provider);
  if (!cmd) throw new Error(`${provider} CLI를 찾을 수 없습니다. 설치 및 로그인 후 다시 시도하세요.`);
  // Empty scratch dir so the CLI never sees project files.
  const cwd = await mkdtemp(join(tmpdir(), 'spm-'));
  try {
    const outFile = provider === 'codex' ? join(cwd, 'last-message.txt') : undefined;
    // Each run uses a fresh folder Gemini has never trusted; it is empty, so trust it for this run only.
    const env = provider === 'gemini' ? { GEMINI_CLI_TRUST_WORKSPACE: 'true' } : undefined;
    let args = argsFor(provider, { model, outFile });
    let r;
    for (let attempt = 0; attempt <= CODEX_DISABLED.length; attempt++) {
      r = await run(cmd, args, { input: prompt, cwd, timeoutMs, env });
      // Only a CLI's own argument error, printed before any model run, may trigger a retry. Codex echoes the
      // prompt to stderr once a run starts, so its banner (or a long stderr) means the text came from the prompt.
      const argError = r.code !== 0 && r.stderr.length < 400 && !/OpenAI Codex v/.test(r.stderr);
      if (!argError) break;
      // An older Codex without one of these features has no such tool to disable: drop just that switch.
      const feature = r.stderr.match(/^Error: Unknown feature flag: (\w+)/m)?.[1];
      if (provider === 'codex' && CODEX_DISABLED.includes(feature)) {
        const i = args.findIndex((a, k) => a === feature && args[k - 1] === '--disable');
        args = [...args.slice(0, i - 1), ...args.slice(i + 1)];
        continue;
      }
      // An older Claude without --safe-mode still runs with no tools and no MCP; only the user's own hooks load.
      if (provider === 'claude' && /^error: unknown option '--safe-mode'/m.test(r.stderr)) {
        args = argsFor(provider, { model, isolate: false });
        continue;
      }
      // Without --ignore-user-config, Codex would load the visitor's MCP servers: refuse rather than run unisolated.
      if (provider === 'codex' && /^error: unexpected argument '--ignore-user-config'/m.test(r.stderr)) {
        throw new Error('Codex CLI가 오래되어 안전 옵션을 지원하지 않습니다. npm i -g @openai/codex 로 업데이트한 뒤 다시 시도하세요.');
      }
      break;
    }
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

// Network failures in words a non-developer can act on.
function networkError(e) {
  const code = e.cause?.code || e.code;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return '서버가 응답하지 않습니다';
  if (code === 'ECONNREFUSED') return '서버에 연결할 수 없습니다. 서버가 켜져 있는지, 주소와 포트가 맞는지 확인하세요';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '서버 주소를 찾을 수 없습니다. 화면에 나온 명령의 주소를 그대로 쓰세요';
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return '서버에 닿지 않습니다. 같은 Wi-Fi(네트워크)에 연결되어 있는지 확인하세요';
  return `서버 연결 오류 (${code || e.message})`;
}

async function api(server, path, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(new URL(path, server), {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(networkError(e));
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A finished generation is worth a few retries: one network blip shouldn't throw it away.
async function postResult(server, token, body) {
  for (let i = 0; ; i++) {
    try { return await api(server, '/api/bridge/result', { method: 'POST', token, body }); } catch (e) {
      // 401: unpaired; 404/409: the job is gone or already finished on the server.
      if ([401, 404, 409].includes(e.status) || i >= 4) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 18) {
    console.log(`Node.js 18 이상이 필요합니다 (지금: ${process.version}). https://nodejs.org 에서 설치한 뒤 다시 실행하세요.`);
    process.exit(1);
  }
  const server = argValue('server');
  const code = argValue('code');
  if (!server || !code) {
    console.log('사용법: node spm-bridge.mjs --server http://<서버주소>:3000 --code <연결코드>');
    process.exit(1);
  }
  if (!/^https?:\/\/[^/\s]+/i.test(server)) {
    console.log(`서버 주소는 http:// 로 시작해야 합니다 (받은 값: ${server}). 브라우저 화면에 나온 명령을 그대로 복사해 실행하세요.`);
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
      // A CLI run takes minutes and the bridge doesn't poll meanwhile; keep the server seeing us online.
      const beat = setInterval(() => { api(server, '/api/bridge/heartbeat', { method: 'POST', token, body: {} }).catch(() => {}); }, HEARTBEAT_MS);
      let result;
      try {
        result = { jobId: job.id, ok: true, output: await runCli(job.provider, job.prompt, { model: job.model }) };
      } catch (e) {
        result = { jobId: job.id, ok: false, error: e.message };
      } finally {
        clearInterval(beat);
      }
      try {
        await postResult(server, token, result);
        console.log(result.ok ? '  ✔ 완료' : `  ✖ ${result.error}`);
      } catch (e) {
        if (e.status === 401) throw e;
        console.log(`  ✖ 결과를 서버에 보내지 못했습니다 (${e.message})`);
      }
    } catch (e) {
      if (e.status === 401) { console.log('⛔ 연결이 해제되었거나 서버가 다시 시작되었습니다. 브라우저에서 새 연결 코드를 받아 다시 실행하세요.'); process.exit(1); }
      console.log(`… 서버 연결 재시도 (${e.message})`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }
}

// Run only when started directly. Compare real paths: on macOS $TMPDIR lives under /var, a symlink to
// /private/var, and Node resolves import.meta.url but not argv[1].
const isMain = () => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
if (isMain()) {
  main().catch((e) => { console.error('오류:', e.message); process.exit(1); });
}
