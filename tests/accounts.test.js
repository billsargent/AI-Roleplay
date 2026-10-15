/**
 * Account and trash safety checks (part of #8).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startServer } from './helpers/server.js';

let srv, admin;
before(async () => {
  srv = await startServer();
  admin = await srv.register(); // first account becomes admin
});
after(async () => { await srv?.stop(); });

const me = (token) => srv.request('GET', '/api/users/me', { token });

test('the first account is admin, later ones are users', async () => {
  assert.equal(admin.user.role, 'admin');
  const u = await srv.register();
  assert.equal(u.user.role, 'user');
});

test('a deleted user\'s token stops working', async () => {
  const u = await srv.register();
  assert.equal((await me(u.token)).status, 200);
  const del = await srv.request('DELETE', `/api/admin/users/${u.user.id}`, { token: admin.token });
  assert.equal(del.status, 204);
  assert.equal((await me(u.token)).status, 401);
});

test('changing the password signs out old sessions but keeps the current one', async () => {
  const u = await srv.register();
  const r = await srv.request('POST', '/api/users/change-password', {
    token: u.token, body: { currentPassword: 'password123', newPassword: 'newpassword456' },
  });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.token, 'a fresh token is returned');
  assert.equal((await me(u.token)).status, 401, 'old token still works');
  assert.equal((await me(r.json.token)).status, 200, 'new token does not work');
});

test('an admin password reset signs the user out', async () => {
  const u = await srv.register();
  const r = await srv.request('PUT', `/api/admin/users/${u.user.id}`, { token: admin.token, body: { password: 'resetpass99' } });
  assert.equal(r.status, 200, r.text);
  assert.equal((await me(u.token)).status, 401);
});

test('admin user routes validate role, password and username', async () => {
  const bad = [
    { username: 'ok_name1', password: 'password123', role: 'superuser' },
    { username: 'ok_name2', password: '123' },
    { username: '<script>', password: 'password123' },
    { username: 'ok_name3', password: 'x'.repeat(80) },
  ];
  for (const body of bad) {
    const r = await srv.request('POST', '/api/admin/users', { token: admin.token, body });
    assert.equal(r.status, 400, JSON.stringify(body) + ' ' + r.text);
  }
  const u = await srv.register();
  const r = await srv.request('PUT', `/api/admin/users/${u.user.id}`, { token: admin.token, body: { role: 'root' } });
  assert.equal(r.status, 400);
  const taken = await srv.request('PUT', `/api/admin/users/${u.user.id}`, { token: admin.token, body: { username: admin.user.username } });
  assert.equal(taken.status, 400);
});

test('the last admin cannot be demoted', async () => {
  const r = await srv.request('PUT', `/api/admin/users/${admin.user.id}`, { token: admin.token, body: { role: 'user' } });
  assert.equal(r.status, 400);
  assert.equal((await me(admin.token)).json.role, 'admin');
});

test('registration validates usernames', async () => {
  const r = await srv.request('POST', '/api/register', { body: { username: 'a b', password: 'password123' } });
  assert.equal(r.status, 400);
});

test('login works with the right password only', async () => {
  const u = await srv.register();
  const ok = await srv.request('POST', '/api/login', { body: { username: u.user.username, password: 'password123' } });
  assert.equal(ok.status, 200);
  const wrong = await srv.request('POST', '/api/login', { body: { username: u.user.username, password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  const unknown = await srv.request('POST', '/api/login', { body: { username: 'nobody_here', password: 'nope-nope' } });
  assert.equal(unknown.status, 401);
});

test('only trashed items can be restored or permanently deleted', async () => {
  const u = await srv.register();
  const scenario = { id: randomUUID(), name: 'S', description: 'd', tags: [], backstory: 'b', characters: [], lorePieces: [], settings: {} };
  assert.equal((await srv.request('POST', '/api/scenarios', { token: u.token, body: scenario })).status, 200);
  const chat = { id: randomUUID(), scenarioId: scenario.id, title: 'c', messages: [], memories: [], settings: {}, createdAt: Date.now() };
  assert.equal((await srv.request('POST', '/api/chats', { token: u.token, body: chat })).status, 200);

  // Not in the trash: refused, and the items survive
  assert.equal((await srv.request('DELETE', `/api/trash/chat/${chat.id}`, { token: u.token })).status, 400);
  assert.equal((await srv.request('DELETE', `/api/trash/scenario/${scenario.id}`, { token: u.token })).status, 400);
  assert.equal((await srv.request('GET', `/api/chats/${chat.id}`, { token: u.token })).status, 200);
  assert.equal((await srv.request('GET', `/api/scenarios/${scenario.id}`, { token: u.token })).status, 200);

  // Trash it, then permanent delete works
  assert.ok([200, 204].includes((await srv.request('DELETE', `/api/chats/${chat.id}`, { token: u.token })).status));
  assert.equal((await srv.request('DELETE', `/api/trash/chat/${chat.id}`, { token: u.token })).status, 204);
});
