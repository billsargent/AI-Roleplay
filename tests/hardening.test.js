/**
 * Server hardening checks (R8, #9): DeepSeek key never leaves the server,
 * sessions survive a restart, successful logins do not use up the limit.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers/server.js';

const dirs = [];
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const newDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rpchat-hard-')); dirs.push(d); return d; };

test('the DeepSeek key is only ever returned masked', async () => {
  const srv = await startServer();
  try {
    const admin = await srv.register();
    const key = 'sk-0123456789abcdefSECRET';
    await srv.request('POST', '/api/system/settings', { token: admin.token, body: { deepseekKey: key } });

    const got = await srv.request('GET', '/api/system/settings', { token: admin.token });
    assert.equal(got.status, 200);
    assert.ok(!got.text.includes('0123456789abcdef'), 'full key was returned');
    assert.equal(got.json.deepseekKeySet, true);
    assert.equal(got.json.deepseekKey, 'sk-…CRET');

    // Saving the masked value back (e.g. the form echoing it) must not replace the real key
    await srv.request('POST', '/api/system/settings', { token: admin.token, body: { deepseekKey: got.json.deepseekKey } });
    const again = await srv.request('GET', '/api/system/settings', { token: admin.token });
    assert.equal(again.json.deepseekKey, 'sk-…CRET');

    // The old raw-key route is gone
    assert.equal((await srv.request('GET', '/api/system/deepseek-key', { token: admin.token })).status, 404);
  } finally {
    await srv.stop();
  }
});

test('sessions survive a server restart without JWT_SECRET set', async () => {
  const dir = newDir();
  const first = await startServer({ dir, env: { JWT_SECRET: '' } });
  const user = await first.register();
  assert.equal((await first.request('GET', '/api/users/me', { token: user.token })).status, 200);
  await first.stop();

  const second = await startServer({ dir, env: { JWT_SECRET: '' } });
  try {
    assert.equal((await second.request('GET', '/api/users/me', { token: user.token })).status, 200);
  } finally {
    await second.stop();
  }
});

test('successful logins do not count toward the login limit', async () => {
  const srv = await startServer();
  try {
    const u = await srv.register();
    for (let i = 0; i < 25; i++) {
      const r = await srv.request('POST', '/api/login', { body: { username: u.user.username, password: 'password123' } });
      assert.equal(r.status, 200, `login ${i + 1} was refused`);
    }
  } finally {
    await srv.stop();
  }
});
