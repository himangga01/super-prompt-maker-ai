// Shared test helpers: a throwaway server and a cookie-holding "browser".
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Starts server.mjs on a random port with its own temporary data folder.
export async function startServer() {
  const port = 39200 + Math.floor(Math.random() * 700);
  const dataDir = await mkdtemp(join(tmpdir(), 'spm-test-'));
  const proc = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SPM_DATA_DIR: dataDir } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('실행 중')) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    dataDir,
    async stop() { proc.kill(); await rm(dataDir, { recursive: true, force: true }); },
  };
}

export function client(base) {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
}

// Follows a job's long-poll until it finishes (each poll waits up to 20s server-side).
export async function waitJob(call, id, maxPolls = 20) {
  let since = 0;
  for (let i = 0; i < maxPolls; i++) {
    const { json } = await call(`/api/jobs/${id}?since=${since}`);
    since = json.updatedAt;
    if (json.status === 'done' || json.status === 'error') return json;
  }
  throw new Error('job never finished');
}
