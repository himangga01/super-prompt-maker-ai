import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { request } from 'node:http';
import { startServer, client as browser, waitJob } from './helpers.mjs';

let server;
let PORT;
let dataDir;
const client = () => browser(server.base);

before(async () => {
  server = await startServer();
  ({ port: PORT, dataDir } = server);
});

after(() => server.stop());

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
  await new Promise((r) => setTimeout(r, 500)); // debounced write
  assert.equal((await readdir(dataDir)).filter((f) => f.endsWith('.json')).length >= 1, true);
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
