// Shared test helpers: a throwaway server and a cookie-holding "browser".
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Starts server.mjs on a free port (PORT=0) with its own temporary data folder. `env` overrides variables;
// a PATH override replaces the inherited one whatever its case (Windows has "Path").
export async function startServer(env = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'spm-test-'));
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !('PATH' in env && /^path$/i.test(k))));
  const proc = spawn(process.execPath, [join(ROOT, 'server.mjs')], { env: { ...base, PORT: '0', HOST: '127.0.0.1', SPM_DATA_DIR: dataDir, ...env } });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });
  const cleanup = async () => { proc.kill(); await rm(dataDir, { recursive: true, force: true }); };
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('server did not start')), 10000);
      proc.stdout.on('data', () => {
        const m = output.match(/http:\/\/localhost:(\d+)/);
        if (m) { clearTimeout(t); resolve(Number(m[1])); }
      });
      proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
    });
  } catch (e) {
    await cleanup();
    throw new Error(`${e.message}\n${output}`);
  }
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    dataDir,
    alive: () => proc.exitCode === null,
    logs: () => output,
    stop: cleanup,
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

// Follows a job's long-poll (each poll waits up to 20s server-side) until it finishes or the deadline passes.
export async function waitJob(call, id, deadlineMs = 25000) {
  const until = Date.now() + deadlineMs;
  let since = 0;
  while (Date.now() < until) {
    const { json } = await call(`/api/jobs/${id}?since=${since}`);
    since = json.updatedAt;
    if (json.status === 'done' || json.status === 'error') return json;
  }
  throw new Error('job never finished');
}
