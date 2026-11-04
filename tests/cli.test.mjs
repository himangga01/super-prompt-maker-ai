// Real Claude / Codex CLI runs. They spend tokens, so they only run when asked:
//   npm run test:cli                     (claude and codex; skipped by plain `npm test`)
//   SPM_CLI_PROVIDERS=codex npm run test:cli
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliEnv, runCli } from '../public/spm-bridge.mjs';
import { startServer, client, waitJob, ROOT } from './helpers.mjs';

const ENABLED = process.env.SPM_CLI_TEST === '1';
const PROVIDERS = (process.env.SPM_CLI_PROVIDERS || 'claude,codex').split(',').map((s) => s.trim()).filter(Boolean);
const HANGUL = /[가-힣]/;
const GEN_DEADLINE = 420000; // a real generation takes 1-3 minutes

// The AI kept the JSON contract (no raw-text fallback) and wrote real, Korean prompts.
function assertGoodResult(job, { count, targets, minLength = 150 }) {
  assert.equal(job.status, 'done', `job failed: ${job.error}`);
  const { analysis, prompts } = job.result;
  assert.doesNotMatch(analysis, /JSON 형식을 지키지/, 'AI ignored the JSON contract');
  assert.equal(prompts.length, count);
  assert.deepEqual(prompts.map((p) => p.target), targets);
  for (const p of prompts) {
    assert.ok(p.prompt.length >= minLength, `prompt too short (${p.prompt.length} chars): ${p.title}`);
    assert.match(p.prompt, HANGUL, 'prompt should be in Korean');
    assert.ok(p.title && p.why, 'title and why should be filled');
  }
  assert.equal(new Set(prompts.map((p) => p.prompt)).size, prompts.length, 'prompts must differ');
}

describe('real CLI generation', { skip: !ENABLED && 'set SPM_CLI_TEST=1 to run (spends tokens)', concurrency: true, timeout: 600000 }, () => {
  let server;
  before(async () => { server = await startServer(); });
  after(() => server?.stop());

  for (const provider of PROVIDERS) {
    test(`${provider}: direct run answers`, async () => {
      const out = await runCli(provider, 'Reply with exactly this text and nothing else: SPM-OK');
      assert.match(out, /SPM-OK/);
    });

    test(`${provider}: option builder via this PC makes 3 Claude-style prompts`, async (t) => {
      const call = client(server.base);
      const started = Date.now();
      const g = await call('/api/generate', { method: 'POST', body: {
        mode: 'build', engine: provider, via: 'local', targets: ['claude'],
        options: { role: 'admin', task: 'document', goal: 'inform', audience: 'public', tone: 'formal', lang: 'ko', techniques: ['examples'], topic: '외국인 근로자 체류기간 연장 신청 안내문' },
      } });
      assert.equal(g.status, 200, g.text);
      const job = await waitJob(call, g.json.jobId, GEN_DEADLINE);
      t.diagnostic(`${provider} build: ${Math.round((Date.now() - started) / 1000)}s`);
      assertGoodResult(job, { count: 3, targets: ['claude', 'claude', 'claude'] });
      assert.equal(job.via, 'local');
      const xml = job.result.prompts.filter((p) => /<[a-z_]+>[\s\S]*<\/[a-z_]+>/.test(p.prompt)).length;
      assert.ok(xml >= 2, `Claude target should use XML tags (only ${xml}/3 did)`);
    });

    test(`${provider}: enhance via this PC writes ChatGPT and Gemini versions`, async (t) => {
      const call = client(server.base);
      const started = Date.now();
      const g = await call('/api/generate', { method: 'POST', body: {
        mode: 'enhance', engine: provider, via: 'local', input: '팀 주간회의 회의록 요약해줘', targets: ['chatgpt', 'gemini'], purpose: 'structure',
      } });
      const job = await waitJob(call, g.json.jobId, GEN_DEADLINE);
      t.diagnostic(`${provider} enhance: ${Math.round((Date.now() - started) / 1000)}s`);
      assertGoodResult(job, { count: 2, targets: ['chatgpt', 'gemini'] });
      for (const p of job.result.prompts) assert.match(p.prompt, /회의록/, 'enhanced prompt must keep the original request');
      assert.match(job.result.prompts[0].prompt, /^#{1,3} \S/m, 'ChatGPT version should use Markdown sections');
    });
  }

  test(`bridge: a real bridge process generates with ${PROVIDERS[0]}`, async (t) => {
    const call = client(server.base);
    const { code } = (await call('/api/bridge/code', { method: 'POST', body: {} })).json;
    const bridge = spawn(process.execPath, [join(ROOT, 'public', 'spm-bridge.mjs'), '--server', server.base, '--code', code]);
    let log = '';
    bridge.stdout.on('data', (d) => { log += d; });
    try {
      for (let i = 0; i < 30 && !(await call('/api/session')).json.bridge.connected; i++) await new Promise((r) => setTimeout(r, 500));
      assert.ok((await call('/api/session')).json.bridge.clis[PROVIDERS[0]].available, `bridge did not report ${PROVIDERS[0]}: ${log}`);
      const started = Date.now();
      const g = await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: PROVIDERS[0], via: 'bridge', input: '2026년 생성형 AI 규제 동향 조사해줘', targets: ['perplexity'], purpose: 'research' } });
      assert.equal(g.status, 200, g.text);
      const job = await waitJob(call, g.json.jobId, GEN_DEADLINE);
      t.diagnostic(`bridge ${PROVIDERS[0]}: ${Math.round((Date.now() - started) / 1000)}s`);
      // The short search version is one precise question by design.
      assertGoodResult(job, { count: 3, targets: ['perplexity', 'perplexity', 'perplexity'], minLength: 40 });
      assert.equal(job.via, 'bridge');
      assert.match(log, /완료/, 'bridge should log the finished job');
    } finally {
      bridge.kill();
    }
  });
});

// The agent skill (skills/super-prompt-maker), installed into a throwaway project, used by the real CLI
// from a plain request. Gemini CLI is not installed on the test PC, so it has no run here yet.
const SKILL_RUNS = {
  claude: 'claude -p --output-format stream-json --verbose --no-session-persistence --strict-mcp-config --allowedTools "Bash(node:*)" Read Skill',
  codex: 'codex exec --skip-git-repo-check --ephemeral --color never --json -',
};

function runAgent(provider, cwd, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(SKILL_RUNS[provider], { cwd, env: cliEnv(), shell: true, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${provider} timed out\n${err.slice(-500)}`)); }, GEN_DEADLINE);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdin.end(prompt);
  });
}

// The final answer from the CLI's JSON event stream (claude: "result" event; codex: last agent message).
function finalAnswer(out) {
  let text = '';
  for (const line of out.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'result' && typeof e.result === 'string') text = e.result;
    if (e.type === 'item.completed' && e.item?.type === 'agent_message') text = e.item.text;
  }
  return text;
}

describe('agent skill in real CLIs', { skip: !ENABLED && 'set SPM_CLI_TEST=1 to run (spends tokens)', concurrency: true, timeout: 600000 }, () => {
  let project;
  before(() => {
    project = mkdtempSync(join(tmpdir(), 'spm-skill-cli-'));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install-skill.mjs'), '--project', project], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
  after(() => rmSync(project, { recursive: true, force: true }));

  for (const provider of PROVIDERS.filter((p) => SKILL_RUNS[p])) {
    test(`${provider}: a plain request picks up the skill and gets three Claude-style prompts`, async (t) => {
      const started = Date.now();
      const { code, out, err } = await runAgent(provider, project, '이 프롬프트 Claude용으로 다듬어줘: 우리 회사 신제품 무선 이어폰 런칭 보도자료 써줘');
      t.diagnostic(`${provider} skill: ${Math.round((Date.now() - started) / 1000)}s`);
      assert.equal(code, 0, err.slice(-500));
      // In the JSON stream the quote after the path is escaped: spm.mjs\" brief, or spm.mjs' brief.
      assert.match(out, /spm\.mjs(\\?["'])? brief/, 'the CLI ran the skill brief');
      const answer = finalAnswer(out);
      const blocks = [...answer.matchAll(/```text\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
      assert.equal(blocks.length, 3, `three variants expected:\n${answer}`);
      for (const b of blocks) {
        assert.match(b, HANGUL, 'prompt should be in Korean');
        assert.match(b, /보도자료/, 'the prompt keeps the original request');
      }
      const xml = blocks.filter((b) => /<[a-z_]+>[\s\S]*<\/[a-z_]+>/.test(b)).length;
      assert.ok(xml >= 2, `Claude target should use XML tags (only ${xml}/3 did)`);
    });
  }
});
