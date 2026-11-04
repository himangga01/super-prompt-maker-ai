// Super Prompt Maker - local web server (zero dependencies).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, labelOf, ROLES, TASKS } from './lib/catalog.mjs';
import { normalizeRequest, buildMetaPrompt, parseAiOutput, templateGenerate } from './lib/engine.mjs';
import { detectClis, runCli, PROVIDERS, MODEL_RE, CLI_TIMEOUT_MS, HEARTBEAT_MS, FETCH_TIMEOUT_MS } from './public/spm-bridge.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.SPM_DATA_DIR || join(ROOT, 'data', 'users');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000; // PORT=0 picks a free port (tests)
const HOST = process.env.HOST || '0.0.0.0';
const ENGINES = [...PROVIDERS, 'template'];
const MAX_HISTORY = 500;
const MAX_LIBRARY = 1000;
// Bridge timing, derived from the bridge's own constants so they can't drift apart:
// a job outlives the CLI timeout plus the bridge's result retries, so the CLI's own error message wins;
// a bridge counts as online for two missed heartbeats; a poll is held well under the bridge's fetch abort.
const JOB_TIMEOUT_MS = CLI_TIMEOUT_MS + 60000;
const BRIDGE_ONLINE_MS = Number(process.env.SPM_BRIDGE_ONLINE_MS) || HEARTBEAT_MS * 2 + 5000;
const POLL_HOLD_MS = Math.min(25000, FETCH_TIMEOUT_MS - 15000);
const GEN_LIMIT_PER_MIN = Number(process.env.SPM_GEN_LIMIT) || 30;
const MAX_HOLDS_PER_CLIENT = 40; // concurrent long-polls one client may keep open

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

// One stray rejection must not take the service down for everyone.
process.on('unhandledRejection', (e) => console.error('처리되지 않은 오류:', e));

// ---------------- per-user storage ----------------
const users = new Map(); // uid -> { history, library }
const transientUsers = new Map(); // never-saved users, capped
const loading = new Map(); // uid -> Promise: one disk read per user, so concurrent requests share one object
const touched = new Map(); // uid -> last use, for evicting idle users from memory
const saveTimers = new Map();
const writes = new Map(); // uid -> Promise of the write in progress (writes run one at a time per user)
const uidOk = (uid) => typeof uid === 'string' && /^[a-f0-9]{32}$/.test(uid);

async function loadUser(uid) {
  if (users.has(uid)) { touched.set(uid, Date.now()); return users.get(uid); }
  if (transientUsers.has(uid)) return transientUsers.get(uid);
  if (!loading.has(uid)) loading.set(uid, readUser(uid).finally(() => loading.delete(uid)));
  return loading.get(uid);
}

async function readUser(uid) {
  const file = join(DATA, `${uid}.json`);
  let text;
  try { text = await readFile(file, 'utf8'); } catch (e) {
    // A locked or unreadable file is not a new user: treating it as one would overwrite the history.
    if (e.code !== 'ENOENT') throw Object.assign(new Error('사용자 데이터를 읽지 못했습니다. 잠시 후 다시 시도하세요.'), { status: 503 });
    // New user: keep in a capped map until something is saved, so cookie-less clients can't grow memory.
    const fresh = { history: [], library: [] };
    if (transientUsers.size >= 1000) transientUsers.delete(transientUsers.keys().next().value);
    transientUsers.set(uid, fresh);
    return fresh;
  }
  let data = {};
  try { data = JSON.parse(text) || {}; } catch {
    // Keep the damaged file for recovery instead of overwriting it with an empty profile.
    await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
    console.error(`손상된 사용자 파일을 ${uid}.json.corrupt-* 로 보관하고 새로 시작합니다.`);
  }
  const user = { history: Array.isArray(data.history) ? data.history : [], library: Array.isArray(data.library) ? data.library : [] };
  users.set(uid, user);
  touched.set(uid, Date.now());
  return user;
}

async function writeUser(uid, user) {
  await mkdir(DATA, { recursive: true });
  const file = join(DATA, `${uid}.json`);
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(user), 'utf8');
  // Antivirus, backup or sync tools on Windows briefly lock files; retry before giving up.
  for (let i = 0; ; i++) {
    try { return await rename(tmp, file); } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await rm(tmp, { force: true }).catch(() => {}); throw e; }
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}

function saveUser(uid, user) {
  if (!users.has(uid)) { users.set(uid, user); transientUsers.delete(uid); }
  touched.set(uid, Date.now());
  clearTimeout(saveTimers.get(uid));
  saveTimers.set(uid, setTimeout(() => {
    saveTimers.delete(uid);
    const write = (writes.get(uid) || Promise.resolve())
      .then(() => writeUser(uid, user))
      .catch((e) => console.error(`사용자 데이터 저장 실패 (${uid}.json): ${e.message}`))
      .finally(() => { if (writes.get(uid) === write) writes.delete(uid); });
    writes.set(uid, write);
  }, 300));
}

// ---------------- bridges & jobs ----------------
const pairCodes = new Map(); // code -> { uid, expires }
const bridges = new Map(); // uid -> { token, clis, hostname, platform, lastSeen, queue: [], waiter }
const bridgeByToken = new Map(); // token -> uid
const jobs = new Map(); // jobId -> job
const hits = new Map(); // "bucket:client" -> recent request timestamps (rate limits)
const holds = new Map(); // client -> open long-polls
let localCli = { at: 0, value: null, pending: null };

// --version checks spawn three processes; reuse the result and ignore forced refreshes more often than every 10s.
function getLocalClis(force = false) {
  const age = Date.now() - localCli.at;
  if (localCli.value && age < 60000 && !(force && age > 10000)) return localCli.value;
  localCli.pending ||= detectClis().then(
    (value) => { localCli = { at: Date.now(), value, pending: null }; return value; },
    (e) => { localCli.pending = null; throw e; });
  return localCli.pending;
}

// Bridges heartbeat while a CLI runs, so a long generation doesn't look like a disconnect.
const bridgeOnline = (b) => b && Date.now() - b.lastSeen < BRIDGE_ONLINE_MS;

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

const isFinished = (job) => job.status === 'done' || job.status === 'error';

function finishJob(job, patch) {
  clearTimeout(job.timeout);
  Object.assign(job, patch, { updatedAt: Date.now() });
  for (const w of job.waiters.splice(0)) w();
}

function failJob(job, error) {
  if (!isFinished(job)) finishJob(job, { status: 'error', error });
}

function armTimeout(job, error) {
  clearTimeout(job.timeout);
  job.timeout = setTimeout(() => failJob(job, error), JOB_TIMEOUT_MS);
}

function wakeBridge(b, superseded = false) {
  if (b.waiter) { const w = b.waiter; b.waiter = null; w(superseded); }
}

// A replaced or removed bridge can never post results for the jobs it was running.
function failRunningBridgeJobs(uid, error) {
  for (const job of jobs.values()) if (job.uid === uid && job.via === 'bridge' && job.status === 'running') failJob(job, error);
}

// A bridge that stopped heartbeating (window closed, PC asleep) will never finish its job: say so now
// instead of letting the browser spin until the job timeout.
function failStaleBridgeJob(job) {
  if (job.via === 'bridge' && job.status === 'running' && !bridgeOnline(bridges.get(job.uid))) {
    failJob(job, '브리지 창이 닫혔거나 연결이 끊겨 생성이 중단되었습니다. 브리지를 다시 실행한 뒤 생성하세요.');
  }
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
  saveUser(uid, user);
  return entry;
}

function dispatchToBridge(b, job) {
  b.queue.push(job);
  wakeBridge(b);
  // The clock restarts when the bridge picks the job up; this one only covers waiting in the queue.
  armTimeout(job, '브리지가 작업을 가져가지 않았습니다. 브리지 창이 켜져 있는지 확인하세요.');
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
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('잘못된 JSON'), { status: 400 }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('JSON 객체가 필요합니다.'), { status: 400 });
  return data;
}

// Reads one cookie. Other apps on the same host share our cookie jar, so a malformed value of theirs must not break us.
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) { try { return decodeURIComponent(v.join('=')); } catch { return undefined; } }
  }
  return undefined;
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
// Behind a local reverse proxy or tunnel every visitor arrives from loopback; such requests are not "this PC".
const isServerPcUser = (req) => isLoopback(req) && !['forwarded', 'x-forwarded-for', 'x-real-ip'].some((h) => req.headers[h]);

// Who to count for limits: the socket address, or, only when a local proxy forwarded the request, the
// address it reports (a LAN client can't fake that: its socket address isn't loopback).
function clientKey(req) {
  const fwd = isLoopback(req) && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress;
}

function rateLimited(req, bucket, limit, windowMs = 60000) {
  const key = `${bucket}:${clientKey(req)}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  const over = recent.length >= limit;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

// Long-polls park a socket for up to 25s; cap how many one client keeps open. Released when the response closes.
function takeHold(req, res) {
  const key = clientKey(req);
  const n = holds.get(key) || 0;
  if (n >= MAX_HOLDS_PER_CLIENT) return false;
  holds.set(key, n + 1);
  res.on('close', () => { const left = (holds.get(key) || 1) - 1; if (left) holds.set(key, left); else holds.delete(key); });
  return true;
}

const loopbackOnly = ['127.0.0.1', '::1', 'localhost'].includes(HOST);
function lanUrls() {
  if (loopbackOnly) return [];
  const port = server.address()?.port ?? PORT;
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(`http://${n.address}:${port}`);
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
    const headers = { 'content-type': type, 'cache-control': extname(file) === '.woff2' ? 'public, max-age=604800' : 'no-cache',
      // No framing by other sites (clickjacking of 기록 비우기 / 연결 해제), no MIME sniffing.
      'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'x-content-type-options': 'nosniff' };
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
  const m = (re) => pathname.match(re);
  let match;

  // --- bridge endpoints (token auth, called from the visitor's PC) ---
  if (pathname === '/api/bridge/pair' && method === 'POST') {
    if (rateLimited(req, 'pair', 20)) return send(res, 429, { error: '연결 시도가 너무 많습니다. 1분 뒤에 다시 시도하세요.' });
    const body = await readJson(req);
    const code = String(body.code || '').toUpperCase();
    const entry = pairCodes.get(code);
    if (!entry || entry.expires < Date.now()) return send(res, 400, { error: '연결 코드가 없거나 만료되었습니다. 브라우저에서 새 코드를 받으세요.' });
    pairCodes.delete(code);
    const clis = Object.fromEntries(PROVIDERS.map((p) => [p, { available: !!body.clis?.[p]?.available, version: String(body.clis?.[p]?.version || '').slice(0, 80) }]));
    const old = bridges.get(entry.uid);
    let queue = [];
    if (old) {
      // Hand waiting jobs to the new bridge if it has their CLI; jobs the old one was running can no longer report back.
      bridgeByToken.delete(old.token);
      for (const j of old.queue) {
        if (isFinished(j)) continue;
        if (clis[j.engine].available) queue.push(j);
        else failJob(j, `새로 연결된 PC에서 ${j.engine} CLI를 사용할 수 없어 작업이 취소되었습니다.`);
      }
      old.queue = [];
      wakeBridge(old, true);
      failRunningBridgeJobs(entry.uid, '브리지가 다시 연결되어 진행 중이던 작업이 취소되었습니다. 다시 생성하세요.');
    }
    const token = randomBytes(24).toString('hex');
    const b = { token, clis, hostname: String(body.hostname || '').slice(0, 60), platform: String(body.platform || '').slice(0, 20), lastSeen: Date.now(), queue, waiter: null };
    bridges.set(entry.uid, b);
    bridgeByToken.set(token, entry.uid);
    return send(res, 200, { token });
  }
  if (['/api/bridge/poll', '/api/bridge/result', '/api/bridge/heartbeat'].includes(pathname)) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const owner = bridgeByToken.get(token);
    const b = owner && bridges.get(owner);
    if (!b) return send(res, 401, { error: 'unauthorized' });
    b.lastSeen = Date.now();
    if (pathname === '/api/bridge/heartbeat') return send(res, 200, { ok: true });
    if (pathname === '/api/bridge/poll') {
      const next = () => {
        // A closed poll can't deliver the job; leave it queued for the next poll.
        if (res.destroyed || res.writableEnded) return false;
        let job;
        while ((job = b.queue.shift()) && isFinished(job)) { /* timed out while queued: drop it */ }
        if (!job) return false;
        job.status = 'running';
        job.updatedAt = Date.now();
        armTimeout(job, '브리지 응답 시간이 초과되었습니다. 브리지 창을 확인하세요.');
        for (const w of job.waiters.splice(0)) w();
        send(res, 200, { id: job.id, provider: job.engine, prompt: job.meta, model: job.model });
        return true;
      };
      if (next()) return;
      if (!takeHold(req, res)) return send(res, 429, { error: '열린 요청이 너무 많습니다.' });
      // One parked poll per bridge: a newer poll releases the older one (empty), so polls can't pile up.
      wakeBridge(b, true);
      const superseded = await new Promise((r) => {
        const wake = (old = false) => { clearTimeout(t); if (b.waiter === wake) b.waiter = null; r(old); };
        const t = setTimeout(wake, POLL_HOLD_MS);
        b.waiter = wake;
        res.on('close', () => wake());
      });
      b.lastSeen = Date.now();
      if (res.writableEnded || res.destroyed) return;
      if (superseded || !next()) send(res, 204, '');
      return;
    }
    const body = await readJson(req);
    const job = jobs.get(body.jobId);
    if (!job || job.uid !== owner) return send(res, 404, { error: 'job not found' });
    // A late or repeated result must not flip a finished job or add a second history entry.
    if (isFinished(job)) return send(res, 409, { error: '이미 끝난 작업입니다.' });
    if (body.ok) await completeWithOutput(job, String(body.output || '').slice(0, 300000));
    else finishJob(job, { status: 'error', error: String(body.error || '브리지 실행 실패').slice(0, 1000) });
    return send(res, 200, { ok: true });
  }

  // --- browser endpoints (cookie auth) ---
  if (!sameOrigin(req)) return send(res, 403, { error: 'cross-origin request blocked' });
  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (method !== 'GET' && contentType !== 'application/json') return send(res, 415, { error: 'JSON only' });

  if (pathname === '/api/catalog') return send(res, 200, catalog);
  const user = await loadUser(uid);

  if (pathname === '/api/session' && method === 'GET') {
    const local = isServerPcUser(req);
    return send(res, 200, {
      isLocal: local, local: local ? await getLocalClis(url.searchParams.has('refresh')) : null,
      bridge: bridgeInfo(uid), lanUrls: lanUrls(), counts: { history: user.history.length, library: user.library.length },
    });
  }

  if (pathname === '/api/bridge/code' && method === 'POST') {
    if (rateLimited(req, 'code', 20)) return send(res, 429, { error: '연결 코드를 너무 자주 만들었습니다. 1분 뒤에 다시 시도하세요.' });
    for (const [c, v] of pairCodes) if (v.uid === uid || v.expires < Date.now()) pairCodes.delete(c);
    if (pairCodes.size >= 1000) pairCodes.delete(pairCodes.keys().next().value);
    const code = newPairCode();
    pairCodes.set(code, { uid, expires: Date.now() + 10 * 60000 });
    return send(res, 200, { code, expiresInSec: 600 });
  }
  if (pathname === '/api/bridge' && method === 'DELETE') {
    const b = bridges.get(uid);
    if (b) {
      bridgeByToken.delete(b.token);
      bridges.delete(uid);
      for (const job of b.queue.splice(0)) failJob(job, '브리지 연결이 해제되었습니다.');
      wakeBridge(b);
      failRunningBridgeJobs(uid, '브리지 연결이 해제되었습니다.');
    }
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/generate' && method === 'POST') {
    if (rateLimited(req, 'generate', GEN_LIMIT_PER_MIN)) return send(res, 429, { error: '요청이 너무 많습니다. 1분 뒤에 다시 시도하세요.' });
    const body = await readJson(req);
    const r = normalizeRequest(body);
    if (r.mode === 'enhance' && !r.input) return send(res, 400, { error: '강화할 프롬프트를 입력하세요.' });
    const engine = ENGINES.includes(body.engine) ? body.engine : 'template';
    const model = typeof body.model === 'string' && MODEL_RE.test(body.model) ? body.model : undefined;
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
      if (!isServerPcUser(req)) return send(res, 403, { error: '서버 PC의 CLI는 서버 PC에서 접속한 경우에만 사용할 수 있습니다. "내 PC 연결"을 이용하세요.' });
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
    dispatchToBridge(b, job);
    return send(res, 200, { jobId: job.id });
  }

  if ((match = m(/^\/api\/jobs\/([\w-]+)$/)) && method === 'GET') {
    const job = jobs.get(match[1]);
    if (!job || job.uid !== uid) return send(res, 404, { error: '작업을 찾을 수 없습니다.' });
    const since = Number(url.searchParams.get('since') || 0);
    failStaleBridgeJob(job);
    if (job.updatedAt <= since && !isFinished(job)) {
      if (!takeHold(req, res)) return send(res, 429, { error: '열린 요청이 너무 많습니다.' });
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
  if (pathname === '/api/history' && method === 'DELETE') { user.history = user.history.filter((h) => h.favorite); saveUser(uid, user); return send(res, 200, { ok: true }); }
  if ((match = m(/^\/api\/history\/([\w-]+)$/))) {
    const idx = user.history.findIndex((h) => h.id === match[1]);
    if (idx < 0) return send(res, 404, { error: '기록을 찾을 수 없습니다.' });
    if (method === 'GET') return send(res, 200, user.history[idx]);
    if (method === 'DELETE') { user.history.splice(idx, 1); saveUser(uid, user); return send(res, 200, { ok: true }); }
    if (method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.favorite === 'boolean') user.history[idx].favorite = body.favorite;
      if (typeof body.title === 'string') user.history[idx].title = body.title.slice(0, 100);
      saveUser(uid, user);
      return send(res, 200, user.history[idx]);
    }
  }

  // library (individually saved prompts)
  if (pathname === '/api/library' && method === 'GET') return send(res, 200, { items: user.library });
  if (pathname === '/api/library' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) return send(res, 400, { error: '저장할 프롬프트가 없습니다.' });
    if (user.library.length >= MAX_LIBRARY) return send(res, 409, { error: `저장함에는 최대 ${MAX_LIBRARY}개까지 저장할 수 있습니다. 쓰지 않는 항목을 지워 주세요.` });
    const historyId = typeof body.historyId === 'string' && /^[\w-]{1,64}$/.test(body.historyId) ? body.historyId : null;
    const item = { id: randomUUID(), createdAt: new Date().toISOString(), title: String(body.title || '저장한 프롬프트').slice(0, 100),
      target: String(body.target || 'universal').slice(0, 30), prompt: body.prompt.slice(0, 20000), memo: String(body.memo || '').slice(0, 1000), historyId };
    user.library.unshift(item);
    saveUser(uid, user);
    return send(res, 200, item);
  }
  if ((match = m(/^\/api\/library\/([\w-]+)$/))) {
    const idx = user.library.findIndex((h) => h.id === match[1]);
    if (idx < 0) return send(res, 404, { error: '저장된 프롬프트를 찾을 수 없습니다.' });
    if (method === 'DELETE') { user.library.splice(idx, 1); saveUser(uid, user); return send(res, 200, { ok: true }); }
    if (method === 'PATCH') {
      const body = await readJson(req);
      for (const k of ['title', 'prompt', 'memo']) if (typeof body[k] === 'string') user.library[idx][k] = body[k].slice(0, k === 'prompt' ? 20000 : 1000);
      user.library[idx].updatedAt = new Date().toISOString();
      saveUser(uid, user);
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
    // The cookie value becomes a file name, so anything that isn't our own 32-hex id is ignored everywhere.
    let uid = getCookie(req, 'spm_uid');
    if (!uidOk(uid)) uid = null;
    if (!uid && !isBridgeCall) {
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
// Long-polls hold the response, not the request, so a finite request timeout only cuts off clients
// that trickle their headers/body to tie up sockets.
server.requestTimeout = 120000;
server.headersTimeout = 60000;

// Fail jobs whose bridge went silent, even when no browser is polling for them.
setInterval(() => { for (const job of jobs.values()) failStaleBridgeJob(job); }, 10000).unref();

// Drop idle users from memory (their data stays on disk), long-gone bridges, stale pair codes and rate counters.
setInterval(() => {
  const now = Date.now();
  for (const [uid, t] of touched) {
    if (now - t < 60 * 60000 || saveTimers.has(uid) || writes.has(uid)) continue;
    users.delete(uid);
    touched.delete(uid);
  }
  for (const [uid, b] of bridges) {
    if (now - b.lastSeen > 60 * 60000) { bridges.delete(uid); bridgeByToken.delete(b.token); }
  }
  for (const [code, v] of pairCodes) if (v.expires < now) pairCodes.delete(code);
  for (const [key, recent] of hits) if (!recent.some((t) => now - t < 60000)) hits.delete(key);
}, 10 * 60000).unref();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n⛔ 포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있습니다. Super Prompt Maker가 이미 켜져 있는지 확인하세요.`);
    console.error('   다른 포트로 실행하려면 PowerShell: $env:PORT=3001; node server.mjs   (macOS/Linux: PORT=3001 node server.mjs)\n');
  } else {
    console.error(`\n⛔ 서버를 시작하지 못했습니다: ${e.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('\n✨ Super Prompt Maker 실행 중');
  console.log(`   이 PC:      http://localhost:${server.address().port}`);
  for (const u of lanUrls()) console.log(`   같은 네트워크: ${u}`);
  console.log('   종료: Ctrl+C\n');
  Promise.resolve(getLocalClis()).catch(() => {});
});
