/**
 * Starts server.js on a free port with a throwaway database and uploads
 * folder, so end-to-end tests never touch real data.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export async function startServer({ env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpchat-test-'));
  const uploads = path.join(dir, 'uploads');
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(dir, 'test.sqlite'),
      UPLOADS_DIR: uploads,
      JWT_SECRET: 'test-secret',
      // Never let tests reach the real DeepSeek API; tests that need it pass a fake server
      DEEPSEEK_BASE_URL: 'http://127.0.0.1:9',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + '/api/images/x');
      break;
    } catch {
      if (child.exitCode !== null) throw new Error('Server exited during startup:\n' + log);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const request = async (method, url, { token, body, raw } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers, raw };
  };

  let userCount = 0;
  const register = async () => {
    const username = `user${++userCount}_${Date.now()}`;
    const r = await request('POST', '/api/register', { body: { username, password: 'password123' } });
    if (r.status !== 200) throw new Error('register failed: ' + r.text);
    return { token: r.json.token, user: r.json.user };
  };

  return {
    base,
    dir,
    uploads,
    request,
    register,
    log: () => log,
    async stop() {
      child.kill();
      await new Promise(r => child.once('exit', r));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
