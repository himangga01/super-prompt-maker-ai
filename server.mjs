// Super Prompt Maker - local web server (zero dependencies).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, labelOf, ROLES, TASKS } from './lib/catalog.mjs';
import { normalizeRequest, buildMetaPrompt, parseAiOutput, templateGenerate } from './lib/engine.mjs';
import { detectClis, runCli, PROVIDERS } from './public/spm-bridge.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.SPM_DATA_DIR || join(ROOT, 'data', 'users');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_HISTORY = 500;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

// ---------------- per-user storage ----------------
const users = new Map(); // uid -> { history, library }
const transientUsers = new Map(); // never-saved users, capped
const saveTimers = new Map();
const uidOk = (uid) => typeof uid === 'string' && /^[a-f0-9]{32}$/.test(uid);

async function loadUser(uid) {
  if (users.has(uid)) return users.get(uid);
  let data = { history: [], library: [] };
  try { data = { ...data, ...JSON.parse(await readFile(join(DATA, `${uid}.json`), 'utf8')) }; } catch {
    // New user: keep in a capped map until something is saved, so cookie-less clients can't grow memory.
    if (!transientUsers.has(uid)) {
      if (transientUsers.size >= 1000) transientUsers.delete(transientUsers.keys().next().value);
      transientUsers.set(uid, data);
    }
    return transientUsers.get(uid);
  }
  users.set(uid, data);
  return data;
}

function saveUser(uid) {
  if (!users.has(uid) && transientUsers.has(uid)) {
    users.set(uid, transientUsers.get(uid));
    transientUsers.delete(uid);
  }
  clearTimeout(saveTimers.get(uid));
  saveTimers.set(uid, setTimeout(async () => {
    await mkdir(DATA, { recursive: true });
    const file = join(DATA, `${uid}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(users.get(uid)), 'utf8');
    await rename(`${file}.tmp`, file);
  }, 300));
}

// ---------------- bridges & jobs ----------------
const pairCodes = new Map(); // code -> { uid, expires }
const bridges = new Map(); // uid -> { token, clis, hostname, platform, lastSeen, queue: [], waiter }
const bridgeByToken = new Map(); // token -> uid
const jobs = new Map(); // jobId -> job
let localClis = null;
let localCliCheckedAt = 0;

async function getLocalClis(force = false) {
  if (force || !localClis || Date.now() - localCliCheckedAt > 60000) {
    localClis = await detectClis();
    localCliCheckedAt = Date.now();
  }
  return localClis;
}

const bridgeOnline = (b) => b && Date.now() - b.lastSeen < 45000;

function bridgeInfo(uid) {
  const b = bridges.get(uid);
  if (!b) return { connected: false };
  return { connected: bridgeOnline(b), clis: b.clis, hostname: b.hostname, platform: b.platform, lastSeen: b.lastSeen };
}

function newPairCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += abc[bytes[i] % abc.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function finishJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  for (const w of job.waiters.splice(0)) w();
}

async function completeWithOutput(job, output) {
  try {
    const parsed = parseAiOutput(output, job.req);
    const entry = await saveHistory(job.uid, job, parsed);
    finishJob(job, { status: 'done', result: entry });
  } catch (e) {
    finishJob(job, { status: 'error', error: e.message });
  }
}

async function saveHistory(uid, job, parsed) {
  const user = await loadUser(uid);
  const { req } = job;
  const entry = {
    id: randomUUID(), createdAt: new Date().toISOString(), mode: req.mode, engine: job.engine, via: job.via,
    title: (req.mode === 'enhance' ? req.input : req.options.topic || [labelOf(ROLES, req.options.role), labelOf(TASKS, req.options.task)].filter(Boolean).join(' · ')).slice(0, 60) || '새 프롬프트',
    request: req, analysis: parsed.analysis, prompts: parsed.prompts, favorite: false,
  };
  user.history.unshift(entry);
  user.history.length = Math.min(user.history.length, MAX_HISTORY);
  saveUser(uid);
  return entry;
}

function dispatchToBridge(uid, job) {
  const b = bridges.get(uid);
  b.queue.push(job);
  if (b.waiter) { const w = b.waiter; b.waiter = null; w(); }
  job.timeout = setTimeout(() => {
    if (job.status === 'queued' || job.status === 'running') finishJob(job, { status: 'error', error: '브리지 응답 시간이 초과되었습니다. 브리지 창을 확인하세요.' });
  }, 420000); // longer than the bridge's own 360s CLI timeout, so its error message wins
}

// ---------------- http helpers ----------------
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('잘못된 JSON'), { status: 400 }); }
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

function lanUrls() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${PORT}`);
  }
  return out;
}

// Only answer to names that really point at this PC, so a DNS-rebinding site can't pose as same-origin.
function hostAllowed(req) {
  const host = (req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  const extra = (process.env.ALLOWED_HOSTS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (['localhost', '127.0.0.1', '::1', ...extra].includes(host)) return true;
  return Object.values(networkInterfaces()).flat().some((n) => n && n.address.toLowerCase() === host);
}

// Browser calls must be same-origin JSON (blocks cross-site form posts / CSRF).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + sep)) return send(res, 403, { error: 'forbidden' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error();
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type, 'cache-control': extname(file) === '.woff2' ? 'public, max-age=604800' : 'no-cache' };
    if (rel === 'spm-bridge.mjs' && new URL(req.url, 'http://x').searchParams.has('download')) headers['content-disposition'] = 'attachment; filename="spm-bridge.mjs"';
    res.writeHead(200, headers);
    res.end(await readFile(file));
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

// ---------------- routes ----------------
async function handleApi(req, res, url, uid) {
  const { pathname } = url;
  const method = req.method;
  const user = uid ? await loadUser(uid) : null;
  const m = (re) => pathname.match(re);
  let match;

  // --- bridge endpoints (token auth, called from the visitor's PC) ---
  if (pathname === '/api/bridge/pair' && method === 'POST') {
    const body = await readJson(req);
    const entry = pairCodes.get(String(body.code || '').toUpperCase());
    if (!entry || entry.expires < Date.now()) return send(res, 400, { error: '연결 코드가 없거나 만료되었습니다. 브라우저에서 새 코드를 받으세요.' });
    pairCodes.delete(String(body.code).toUpperCase());
    const old = bridges.get(entry.uid);
    if (old) bridgeByToken.delete(old.token);
    const token = randomBytes(24).toString('hex');
    const clis = Object.fromEntries(PROVIDERS.map((p) => [p, { available: !!body.clis?.[p]?.available, version: String(body.clis?.[p]?.version || '').slice(0, 80) }]));
    bridges.set(entry.uid, { token, clis, hostname: String(body.hostname || '').slice(0, 60), platform: String(body.platform || '').slice(0, 20), lastSeen: Date.now(), queue: [], waiter: null });
    bridgeByToken.set(token, entry.uid);
    return send(res, 200, { token });
  }
  if (pathname.startsWith('/api/bridge/') && ['/api/bridge/poll', '/api/bridge/result'].includes(pathname)) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const owner = bridgeByToken.get(token);
    const b = owner && bridges.get(owner);
    if (!b) return send(res, 401, { error: 'unauthorized' });
    b.lastSeen = Date.now();
    if (pathname === '/api/bridge/poll') {
      const next = () => {
        // A closed poll can't deliver the job; leave it queued for the next poll.
        if (res.destroyed || res.writableEnded) return false;
        const job = b.queue.shift();
        if (!job) return false;
        job.status = 'running';
        job.updatedAt = Date.now();
        for (const w of job.waiters.splice(0)) w();
        send(res, 200, { id: job.id, provider: job.engine, prompt: job.meta, model: job.model });
        return true;
      };
      if (next()) return;
      await new Promise((r) => {
        const wake = () => { clearTimeout(t); if (b.waiter === wake) b.waiter = null; r(); };
        const t = setTimeout(wake, 25000);
        b.waiter = wake;
        res.on('close', wake);
      });
      b.lastSeen = Date.now();
      if (res.writableEnded || res.destroyed) return;
      if (!next()) send(res, 204, '');
      return;
    }
    const body = await readJson(req);
    const job = jobs.get(body.jobId);
    if (!job || job.uid !== owner) return send(res, 404, { error: 'job not found' });
    clearTimeout(job.timeout);
    if (body.ok) await completeWithOutput(job, String(body.output || ''));
    else finishJob(job, { status: 'error', error: String(body.error || '브리지 실행 실패').slice(0, 1000) });
    return send(res, 200, { ok: true });
  }

  // --- browser endpoints (cookie auth) ---
  if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin request blocked' });
  if (method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'JSON only' });

  if (pathname === '/api/catalog') return send(res, 200, catalog);

  if (pathname === '/api/session' && method === 'GET') {
    const local = isLoopback(req);
    return send(res, 200, {
      isLocal: local, local: local ? await getLocalClis(url.searchParams.has('refresh')) : null,
      bridge: bridgeInfo(uid), lanUrls: lanUrls(), counts: { history: user.history.length, library: user.library.length },
    });
  }

  if (pathname === '/api/bridge/code' && method === 'POST') {
    for (const [c, v] of pairCodes) if (v.uid === uid || v.expires < Date.now()) pairCodes.delete(c);
    const code = newPairCode();
    pairCodes.set(code, { uid, expires: Date.now() + 10 * 60000 });
    return send(res, 200, { code, expiresInSec: 600 });
  }
  if (pathname === '/api/bridge' && method === 'DELETE') {
    const b = bridges.get(uid);
    if (b) { bridgeByToken.delete(b.token); bridges.delete(uid); }
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/generate' && method === 'POST') {
    const body = await readJson(req);
    const r = normalizeRequest(body);
    if (r.mode === 'enhance' && !r.input) return send(res, 400, { error: '강화할 프롬프트를 입력하세요.' });
    const engine = ['claude', 'codex', 'gemini', 'template'].includes(body.engine) ? body.engine : 'template';
    const model = typeof body.model === 'string' && /^[\w.\-:\[\]]{1,64}$/.test(body.model) ? body.model : undefined;
    const job = { id: randomUUID(), uid, req: r, engine, model, status: 'queued', waiters: [], createdAt: Date.now(), updatedAt: Date.now() };
    jobs.set(job.id, job);
    setTimeout(() => jobs.delete(job.id), 30 * 60000);

    if (engine === 'template') {
      job.via = 'template';
      await completeWithOutput(job, JSON.stringify(templateGenerate(r)));
      return send(res, 200, { jobId: job.id });
    }
    job.meta = buildMetaPrompt(r);
    const wantLocal = body.via === 'local';
    if (wantLocal) {
      // Only the person sitting at the server PC may spend the server owner's CLI account.
      if (!isLoopback(req)) return send(res, 403, { error: '서버 PC의 CLI는 서버 PC에서 접속한 경우에만 사용할 수 있습니다. "내 PC 연결"을 이용하세요.' });
      job.via = 'local';
      job.status = 'running';
      runCli(engine, job.meta, { model })
        .then((out) => completeWithOutput(job, out))
        .catch((e) => finishJob(job, { status: 'error', error: e.message }));
      return send(res, 200, { jobId: job.id });
    }
    const b = bridges.get(uid);
    if (!bridgeOnline(b)) return send(res, 409, { error: '연결된 내 PC 브리지가 없습니다. "AI 연결" 탭에서 내 PC를 연결하세요.' });
    if (!b.clis[engine]?.available) return send(res, 409, { error: `연결된 PC에서 ${engine} CLI를 사용할 수 없습니다.` });
    job.via = 'bridge';
    dispatchToBridge(uid, job);
    return send(res, 200, { jobId: job.id });
  }

  if ((match = m(/^\/api\/jobs\/([\w-]+)$/)) && method === 'GET') {
    const job = jobs.get(match[1]);
    if (!job || job.uid !== uid) return send(res, 404, { error: '작업을 찾을 수 없습니다.' });
    const since = Number(url.searchParams.get('since') || 0);
    if (job.updatedAt <= since && (job.status === 'queued' || job.status === 'running')) {
      await new Promise((r) => { const t = setTimeout(r, 20000); job.waiters.push(() => { clearTimeout(t); r(); }); res.on('close', r); });
    }
    if (res.destroyed) return;
    return send(res, 200, { id: job.id, status: job.status, engine: job.engine, via: job.via, error: job.error, result: job.result, updatedAt: job.updatedAt, createdAt: job.createdAt });
  }

  // history
  if (pathname === '/api/history' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const mode = url.searchParams.get('mode');
    const fav = url.searchParams.get('fav') === '1';
    const items = user.history.filter((h) => (!mode || h.mode === mode) && (!fav || h.favorite)
      && (!q || JSON.stringify([h.title, h.request?.input, h.prompts?.map((p) => p.prompt)]).toLowerCase().includes(q)));
    return send(res, 200, { items });
  }
  if (pathname === '/api/history' && method === 'DELETE') { user.history = user.history.filter((h) => h.favorite); saveUser(uid); return send(res, 200, { ok: true }); }
  if ((match = m(/^\/api\/history\/([\w-]+)$/))) {
    const idx = user.history.findIndex((h) => h.id === match[1]);
    if (idx < 0) return send(res, 404, { error: '기록을 찾을 수 없습니다.' });
    if (method === 'GET') return send(res, 200, user.history[idx]);
    if (method === 'DELETE') { user.history.splice(idx, 1); saveUser(uid); return send(res, 200, { ok: true }); }
    if (method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.favorite === 'boolean') user.history[idx].favorite = body.favorite;
      if (typeof body.title === 'string') user.history[idx].title = body.title.slice(0, 100);
      saveUser(uid);
      return send(res, 200, user.history[idx]);
    }
  }

  // library (individually saved prompts)
  if (pathname === '/api/library' && method === 'GET') return send(res, 200, { items: user.library });
  if (pathname === '/api/library' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) return send(res, 400, { error: '저장할 프롬프트가 없습니다.' });
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), title: String(body.title || '저장한 프롬프트').slice(0, 100),
      target: String(body.target || 'universal').slice(0, 30), prompt: body.prompt.slice(0, 20000), memo: String(body.memo || '').slice(0, 1000), historyId: body.historyId || null };
    user.library.unshift(item);
    saveUser(uid);
    return send(res, 200, item);
  }
  if ((match = m(/^\/api\/library\/([\w-]+)$/))) {
    const idx = user.library.findIndex((h) => h.id === match[1]);
    if (idx < 0) return send(res, 404, { error: '저장된 프롬프트를 찾을 수 없습니다.' });
    if (method === 'DELETE') { user.library.splice(idx, 1); saveUser(uid); return send(res, 200, { ok: true }); }
    if (method === 'PATCH') {
      const body = await readJson(req);
      for (const k of ['title', 'prompt', 'memo']) if (typeof body[k] === 'string') user.library[idx][k] = body[k].slice(0, k === 'prompt' ? 20000 : 1000);
      user.library[idx].updatedAt = new Date().toISOString();
      saveUser(uid);
      return send(res, 200, user.library[idx]);
    }
  }

  if (pathname === '/api/export' && method === 'GET') {
    const fmt = url.searchParams.get('format');
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'md') {
      const md = ['# Super Prompt Maker 내보내기', '', '## 저장함', ...user.library.flatMap((l) => [`### ${l.title} (${l.target})`, '', '```', l.prompt, '```', '']),
        '## 히스토리', ...user.history.flatMap((h) => [`### ${h.title} — ${h.createdAt.slice(0, 16).replace('T', ' ')}`, '', ...h.prompts.flatMap((p) => [`#### ${p.title}`, '', '```', p.prompt, '```', ''])])].join('\n');
      return send(res, 200, md, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="super-prompts-${stamp}.md"` });
    }
    return send(res, 200, JSON.stringify({ exportedAt: new Date().toISOString(), library: user.library, history: user.history }, null, 2),
      { 'content-disposition': `attachment; filename="super-prompts-${stamp}.json"` });
  }

  return send(res, 404, { error: 'not found' });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!hostAllowed(req)) return send(res, 421, { error: '허용되지 않은 호스트 이름입니다. ALLOWED_HOSTS 환경 변수에 추가하세요.' });
    const isBridgeCall = url.pathname.startsWith('/api/bridge/') && url.pathname !== '/api/bridge/code';
    let uid = parseCookies(req).spm_uid;
    if (!isBridgeCall && !uidOk(uid)) {
      uid = randomBytes(16).toString('hex');
      res.setHeader('set-cookie', `spm_uid=${uid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, uid);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : '서버 오류가 발생했습니다.' });
    if (!e.status) console.error(e);
  }
});
server.requestTimeout = 0;
server.headersTimeout = 60000;

server.listen(PORT, HOST, () => {
  console.log('\n✨ Super Prompt Maker 실행 중');
  console.log(`   이 PC:      http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`   같은 네트워크: ${u}`);
  console.log('   종료: Ctrl+C\n');
  getLocalClis().catch(() => {});
});
