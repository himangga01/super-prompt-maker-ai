import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { startServer, client as browser, waitJob } from './helpers.mjs';

let server;
let PORT;
let dataDir;
const client = () => browser(server.base);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls until `check` returns truthy, instead of guessing how long a debounced write takes.
async function eventually(check, ms = 5000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check().catch(() => null);
    if (v || Date.now() > until) return v;
    await sleep(50);
  }
}

before(async () => {
  server = await startServer();
  ({ port: PORT, dataDir } = server);
});

after(() => server?.stop());

test('catalog lists target services', async () => {
  const { status, json } = await client()('/api/catalog');
  assert.equal(status, 200);
  assert.ok(json.TARGETS.some((t) => t.id === 'claude'));
});

test('template generation is saved to history with a Korean title and persisted to disk', async () => {
  const call = client();
  const g = await call('/api/generate', { method: 'POST', body: { mode: 'build', engine: 'template', targets: ['gemini'], options: { role: 'marketer', task: 'write' } } });
  assert.equal(g.status, 200);
  const job = await waitJob(call, g.json.jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.prompts.length, 3);
  assert.equal(job.result.title, '마케터 · 글쓰기');
  const h = await call('/api/history');
  assert.equal(h.json.items.length, 1);
  // The file on disk must hold this very entry, not just exist.
  const saved = await eventually(async () => {
    for (const f of (await readdir(dataDir)).filter((n) => n.endsWith('.json'))) {
      const data = JSON.parse(await readFile(join(dataDir, f), 'utf8'));
      if (data.history?.some((e) => e.id === job.result.id)) return true;
    }
    return false;
  });
  assert.ok(saved, 'history entry written to disk');
});

test('enhance without input is rejected', async () => {
  const { status } = await client()('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'template', input: '  ' } });
  assert.equal(status, 400);
});

test('history: favorite, search, clear keeps favorites, delete', async () => {
  const call = client();
  for (const input of ['첫번째 요청', '두번째 요청']) {
    const g = await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'template', input, targets: ['chatgpt'] } });
    await waitJob(call, g.json.jobId);
  }
  let items = (await call('/api/history')).json.items;
  assert.equal(items.length, 2);
  const fav = items.find((h) => h.title.includes('첫번째'));
  assert.equal((await call(`/api/history/${fav.id}`, { method: 'PATCH', body: { favorite: true } })).json.favorite, true);
  assert.equal((await call(`/api/history?q=${encodeURIComponent('두번째')}`)).json.items.length, 1);
  assert.equal((await call('/api/history?fav=1')).json.items.length, 1);
  await call('/api/history', { method: 'DELETE', body: {} });
  items = (await call('/api/history')).json.items;
  assert.deepEqual(items.map((h) => h.id), [fav.id]);
  assert.equal((await call(`/api/history/${fav.id}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await call('/api/history')).json.items.length, 0);
});

test('history is private to each browser', async () => {
  const a = client();
  const b = client();
  const g = await a('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'template', input: 'secret', targets: ['claude'] } });
  const job = await waitJob(a, g.json.jobId);
  assert.equal((await b('/api/history')).json.items.length, 0);
  assert.equal((await b(`/api/history/${job.result.id}`)).status, 404);
  assert.equal((await b(`/api/jobs/${g.json.jobId}`)).status, 404);
});

test('library: create, edit, export, delete', async () => {
  const call = client();
  const created = await call('/api/library', { method: 'POST', body: { title: 'T', prompt: 'PROMPT-BODY', target: 'claude' } });
  assert.equal(created.status, 200);
  assert.equal((await call('/api/library', { method: 'POST', body: { title: 'empty', prompt: ' ' } })).status, 400);
  const edited = await call(`/api/library/${created.json.id}`, { method: 'PATCH', body: { title: 'T2', memo: 'm' } });
  assert.equal(edited.json.title, 'T2');
  const md = await call('/api/export?format=md');
  assert.match(md.headers.get('content-disposition'), /\.md"/);
  assert.match(md.text, /PROMPT-BODY/);
  const json = await call('/api/export?format=json');
  assert.equal(JSON.parse(json.text).library[0].title, 'T2');
  assert.equal((await call(`/api/library/${created.json.id}`, { method: 'DELETE', body: {} })).status, 200);
  assert.equal((await call('/api/library')).json.items.length, 0);
});

test('security: cross-origin, foreign Host, non-JSON body and path traversal are refused', async () => {
  const call = client();
  assert.equal((await call('/api/history', { headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await call('/api/library', { method: 'POST', body: 'title=x', headers: { 'content-type': 'text/plain' } })).status, 415);
  const raw = (path, host) => new Promise((resolve) => {
    request({ host: '127.0.0.1', port: PORT, path, headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(await raw('/api/catalog', `evil.example:${PORT}`), 421);
  // Dot segments are collapsed by URL parsing, so these stay inside public/ and 404.
  assert.equal(await raw('/../server.mjs', `localhost:${PORT}`), 404);
  assert.equal(await raw('/%2e%2e/server.mjs', `localhost:${PORT}`), 404);
  // Encoded separators survive parsing and must hit the traversal guard.
  assert.equal(await raw('/..%2fserver.mjs', `localhost:${PORT}`), 403);
  assert.equal(await raw('/..%5cserver.mjs', `localhost:${PORT}`), 403);
});

test('CLI generation without a bridge is refused', async () => {
  const { status, json } = await client()('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', input: 'x' } });
  assert.equal(status, 409);
  assert.match(json.error, /브리지/);
});

test('bridge: pair once, receive the job, post the result back', async () => {
  const call = client();
  const { code } = (await call('/api/bridge/code', { method: 'POST', body: {} })).json;
  const bridge = client();
  const clis = { claude: { available: false }, codex: { available: true, version: 'test' }, gemini: { available: false } };
  const paired = await bridge('/api/bridge/pair', { method: 'POST', body: { code, clis, hostname: 'test-pc' } });
  assert.equal(paired.status, 200);
  assert.equal((await bridge('/api/bridge/pair', { method: 'POST', body: { code, clis } })).status, 400, 'code is single-use');
  const auth = { authorization: `Bearer ${paired.json.token}` };
  assert.equal((await bridge('/api/bridge/poll', { headers: { authorization: 'Bearer wrong' } })).status, 401);

  const session = (await call('/api/session')).json;
  assert.equal(session.bridge.connected, true);
  assert.equal(session.bridge.hostname, 'test-pc');
  // claude is not available on that bridge
  assert.equal((await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'claude', input: 'x' } })).status, 409);

  const g = await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', via: 'bridge', input: '엑셀 합치기', targets: ['chatgpt'] } });
  assert.equal(g.status, 200);
  const job = await bridge('/api/bridge/poll', { headers: auth });
  assert.equal(job.json.provider, 'codex');
  assert.match(job.json.prompt, /엑셀 합치기/);
  const output = JSON.stringify({ analysis: 'ok', prompts: [{ title: 'A', target: 'chatgpt', variant: 'v', prompt: 'FROM-BRIDGE' }] });
  assert.equal((await bridge('/api/bridge/result', { method: 'POST', headers: auth, body: { jobId: job.json.id, ok: true, output } })).status, 200);
  const done = await waitJob(call, g.json.jobId);
  assert.equal(done.status, 'done');
  assert.equal(done.via, 'bridge');
  assert.equal(done.result.prompts[0].prompt, 'FROM-BRIDGE');

  // A bridge error surfaces to the browser.
  const g2 = await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', input: 'y', targets: ['chatgpt'] } });
  const job2 = await bridge('/api/bridge/poll', { headers: auth });
  await bridge('/api/bridge/result', { method: 'POST', headers: auth, body: { jobId: job2.json.id, ok: false, error: 'login expired' } });
  const failed = await waitJob(call, g2.json.jobId);
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'login expired');

  await call('/api/bridge', { method: 'DELETE', body: {} });
  assert.equal((await bridge('/api/bridge/poll', { headers: auth })).status, 401);
});

// Pairs a fake bridge for a fresh browser and returns helpers for both sides.
async function pairBridge(call) {
  const { code } = (await call('/api/bridge/code', { method: 'POST', body: {} })).json;
  const bridge = client();
  const clis = { claude: { available: false }, codex: { available: true }, gemini: { available: false } };
  const { token } = (await bridge('/api/bridge/pair', { method: 'POST', body: { code, clis } })).json;
  const auth = { authorization: `Bearer ${token}` };
  return { bridge, auth, poll: () => bridge('/api/bridge/poll', { headers: auth }) };
}
const generate = (call, input) => call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', input, targets: ['chatgpt'] } });

test('bridge: a repeated or late result is refused and adds no second history entry', async () => {
  const call = client();
  const { bridge, auth, poll } = await pairBridge(call);
  const g = await generate(call, 'once');
  const job = (await poll()).json;
  const body = { jobId: job.id, ok: true, output: '{"prompts":[{"prompt":"P"}]}' };
  assert.equal((await bridge('/api/bridge/result', { method: 'POST', headers: auth, body })).status, 200);
  assert.equal((await bridge('/api/bridge/result', { method: 'POST', headers: auth, body })).status, 409);
  assert.equal((await waitJob(call, g.json.jobId)).status, 'done');
  assert.equal((await call('/api/history')).json.items.length, 1);
});

test('bridge: heartbeat updates lastSeen; re-pairing hands queued jobs over; unpairing fails running jobs', async () => {
  const call = client();
  const first = await pairBridge(call);
  const seen = (await call('/api/session')).json.bridge.lastSeen;
  await sleep(20);
  assert.equal((await first.bridge('/api/bridge/heartbeat', { method: 'POST', headers: first.auth, body: {} })).status, 200);
  assert.ok((await call('/api/session')).json.bridge.lastSeen > seen, 'a heartbeat counts as being online');
  const running = await generate(call, 'running on the old bridge');
  await first.poll();
  const queued = await generate(call, 'still queued');
  const second = await pairBridge(call);
  const failed = await waitJob(call, running.json.jobId);
  assert.equal(failed.status, 'error', 'the replaced bridge can never report back');
  assert.equal((await second.poll()).json.id, queued.json.jobId, 'the queued job moved to the new bridge');
  const third = await generate(call, 'queued then unpaired');
  // The UI sends DELETE with an empty JSON body; without the JSON content type the server refuses it.
  assert.equal((await call('/api/bridge', { method: 'DELETE' })).status, 415);
  await call('/api/bridge', { method: 'DELETE', body: {} });
  assert.equal((await waitJob(call, queued.json.jobId)).status, 'error', 'unpairing fails the job that was running');
  assert.equal((await waitJob(call, third.json.jobId)).status, 'error', 'and the one still queued');
});

test('bridge: results only from the owning bridge; one parked poll per bridge; the job long-poll waits', async () => {
  const a = client();
  const b = client();
  const bridgeA = await pairBridge(a);
  const bridgeB = await pairBridge(b);
  const g = await generate(a, 'owned by A');
  const job = (await bridgeA.poll()).json;
  const body = { jobId: job.id, ok: true, output: '{"prompts":[{"prompt":"P"}]}' };
  assert.equal((await bridgeB.bridge('/api/bridge/result', { method: 'POST', headers: bridgeB.auth, body })).status, 404);

  const { updatedAt } = (await a(`/api/jobs/${g.json.jobId}`)).json;
  let settled = false;
  const pending = a(`/api/jobs/${g.json.jobId}?since=${updatedAt}`).then((r) => { settled = true; return r; });
  await sleep(150);
  assert.equal(settled, false, 'the long-poll holds while the job runs');
  await bridgeA.bridge('/api/bridge/result', { method: 'POST', headers: bridgeA.auth, body });
  assert.equal((await pending).json.status, 'done');

  const t = Date.now();
  const older = bridgeB.poll();
  await sleep(50);
  const newer = bridgeB.poll();
  assert.equal((await older).status, 204);
  assert.ok(Date.now() - t < 5000, 'a newer poll releases the older one at once');
  await b('/api/bridge', { method: 'DELETE', body: {} });
  assert.equal((await newer).status, 204);
});

test('bridge: model names never reach the CLI as options', async () => {
  const call = client();
  const { poll } = await pairBridge(call);
  await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', input: 'x', model: '--yolo' } });
  assert.equal((await poll()).json.model, undefined);
  await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', input: 'x', model: 'gpt-5.1' } });
  assert.equal((await poll()).json.model, 'gpt-5.1');
});

test('input edge cases: malformed cookies, non-object JSON, odd historyId', async () => {
  const call = client();
  assert.equal((await call('/api/session', { headers: { cookie: 'spm_uid=%E0%A4%A' } })).status, 200, 'an undecodable cookie is ignored');
  assert.equal((await call('/api/library', { method: 'POST', body: 'null' })).status, 400);
  assert.equal((await call('/api/library', { method: 'POST', body: '[1]' })).status, 400);
  const item = await call('/api/library', { method: 'POST', body: { prompt: 'p', historyId: { big: 'x'.repeat(1000) } } });
  assert.equal(item.json.historyId, null);
  assert.ok(server.alive());
});

test('an invalid cookie id is replaced, never used as a file name', async () => {
  for (const bad of ['..%2F..%2Fescaped', '../../x', 'ABCDEF0123456789abcdef0123456789']) {
    const res = await fetch(`${server.base}/api/library`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `spm_uid=${bad}` }, body: '{"prompt":"p"}' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') || '', /^spm_uid=[a-f0-9]{32};/, `fresh id for ${bad}`);
  }
  await sleep(500);
  const parent = await readdir(dirname(dataDir));
  assert.ok(!parent.includes('escaped.json'), 'nothing written outside the data folder');
});

test('the server PC CLI is refused to proxied requests; generation is rate limited', async () => {
  // Only node on PATH: even if the guard broke, no real CLI could run and spend tokens.
  const isolated = await startServer({ PATH: dirname(process.execPath), SPM_GEN_LIMIT: '3' });
  try {
    const call = browser(isolated.base);
    const fwd = { 'x-forwarded-for': '203.0.113.9' };
    const local = await call('/api/generate', { method: 'POST', headers: fwd, body: { mode: 'enhance', engine: 'codex', via: 'local', input: 'x' } });
    assert.equal(local.status, 403);
    assert.equal((await call('/api/session', { headers: fwd })).json.isLocal, false);
    assert.equal((await call('/api/session')).json.isLocal, true);
    const gen = () => call('/api/generate', { method: 'POST', body: { mode: 'build', engine: 'template' } });
    assert.deepEqual([(await gen()).status, (await gen()).status, (await gen()).status, (await gen()).status], [200, 200, 200, 429]);
    const other = await call('/api/generate', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.7' }, body: { mode: 'build', engine: 'template' } });
    assert.equal(other.status, 200, 'behind a local proxy each forwarded client has its own budget');
  } finally { await isolated.stop(); }
});

test('a bridge that goes silent fails its running job instead of leaving it spinning', async () => {
  const quick = await startServer({ SPM_BRIDGE_ONLINE_MS: '300' });
  try {
    const call = browser(quick.base);
    const { code } = (await call('/api/bridge/code', { method: 'POST', body: {} })).json;
    const bridge = browser(quick.base);
    const { token } = (await bridge('/api/bridge/pair', { method: 'POST', body: { code, clis: { codex: { available: true } } } })).json;
    const g = await call('/api/generate', { method: 'POST', body: { mode: 'enhance', engine: 'codex', input: 'x' } });
    await bridge('/api/bridge/poll', { headers: { authorization: `Bearer ${token}` } });
    await sleep(400);
    const job = await waitJob(call, g.json.jobId, 3000);
    assert.equal(job.status, 'error');
    assert.match(job.error, /브리지 창이 닫혔거나/);
  } finally { await quick.stop(); }
});

test('storage: concurrent first loads share one user, and a corrupt file is kept, not overwritten', async () => {
  const uid = randomBytes(16).toString('hex');
  const as = { cookie: `spm_uid=${uid}` };
  await writeFile(join(dataDir, `${uid}.json`), JSON.stringify({ history: [], library: [{ id: 'a', title: 'old', prompt: 'old' }] }));
  const call = client();
  await Promise.all(Array.from({ length: 5 }, (_, i) => Promise.all([
    call('/api/library', { method: 'POST', body: { prompt: `new ${i}` }, headers: as }),
    call('/api/session', { headers: as }),
  ])));
  assert.equal((await call('/api/library', { headers: as })).json.items.length, 6);

  const bad = randomBytes(16).toString('hex');
  await writeFile(join(dataDir, `${bad}.json`), '{"history": [tru');
  assert.equal((await call('/api/history', { headers: { cookie: `spm_uid=${bad}` } })).status, 200);
  assert.ok((await readdir(dataDir)).some((f) => f.startsWith(`${bad}.json.corrupt-`)));
});

test('a failing disk write is logged, not fatal', async () => {
  // A data folder under a regular file can never be created.
  const broken = await startServer({ SPM_DATA_DIR: join(dataDir, 'not-a-dir.json', 'users') });
  try {
    await writeFile(join(dataDir, 'not-a-dir.json'), '{}');
    const call = browser(broken.base);
    const g = await call('/api/generate', { method: 'POST', body: { mode: 'build', engine: 'template' } });
    assert.equal((await waitJob(call, g.json.jobId)).status, 'done');
    assert.ok(await eventually(async () => broken.logs().includes('사용자 데이터 저장 실패')), 'the failure is logged');
    assert.ok(broken.alive());
    assert.equal((await call('/api/catalog')).status, 200);
  } finally { await broken.stop(); }
});
