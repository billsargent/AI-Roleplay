/**
 * End-to-end security checks against a server running on a throwaway
 * database and uploads folder (see tests/helpers/server.js).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { startServer } from './helpers/server.js';

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv?.stop(); });

const rawGet = (url) => fetch(srv.base + url).then(r => r.status);

/** Sends the path exactly as written (fetch would normalize "../" away) */
const rawPath = (p) => new Promise((resolve, reject) => {
  const { port } = new URL(srv.base);
  http.get({ host: '127.0.0.1', port, path: p }, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});

test('R1: image route refuses path traversal', async () => {
  // A file outside the uploads folder that an attacker would want
  fs.writeFileSync(path.join(srv.dir, 'secret.webp'), 'secret');
  for (const p of [
    '/api/images/../secret.webp',
    '/api/images/scenarios/../../secret.webp',
    '/api/images/..%2fsecret.webp',
    '/api/images/%2e%2e/secret.webp',
    '/api/images/scenarios/a1/..%5c..%5csecret.webp',
  ]) {
    const r = await rawPath(p);
    assert.equal(r.status, 400, `${p} returned ${r.status}`);
    assert.ok(!r.body.includes('secret'), `${p} leaked the file`);
  }
});

test('R1: a stored avatar path cannot delete files outside uploads', async () => {
  const { token } = await srv.register();
  const canary = path.join(srv.dir, 'canary.webp');
  fs.writeFileSync(canary, 'do not delete');

  const id = randomUUID();
  const r = await srv.request('POST', '/api/personas', {
    token, body: { id, name: 'Evil', description: '', avatar: '/api/images/../canary.webp' },
  });
  assert.equal(r.status, 200);
  const del = await srv.request('DELETE', `/api/personas/${id}`, { token });
  assert.equal(del.status, 204);
  assert.ok(fs.existsSync(canary), 'canary file outside uploads was deleted');
});

test('R1: unsafe entity ids cannot write outside uploads', async () => {
  const { token } = await srv.register();
  await srv.request('POST', '/api/personas', {
    token, body: { id: '../../escaped', name: 'x', description: '', avatar: PNG },
  });
  assert.ok(!fs.existsSync(path.join(srv.dir, 'escaped.png')));
  assert.ok(!fs.existsSync(path.join(srv.uploads, '..', 'escaped.png')));
});

test('R2: image proxy requires login', async () => {
  const r = await srv.request('GET', '/api/proxy-image?url=' + encodeURIComponent('https://example.com/x.png'));
  assert.equal(r.status, 401);
});

test('R2: image proxy refuses internal addresses', async () => {
  const { token } = await srv.register();
  for (const url of [
    srv.base + '/api/users/me',
    'http://localhost:1/',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://10.0.0.1/',
    'file:///etc/passwd',
  ]) {
    const r = await srv.request('GET', '/api/proxy-image?url=' + encodeURIComponent(url), { token });
    assert.equal(r.status, 400, `${url} returned ${r.status}: ${r.text}`);
    assert.equal(r.json?.dataUrl, undefined);
  }
});

/** Minimal valid scenario body */
const scenarioBody = (over = {}) => ({
  id: randomUUID(), name: 'S', description: 'd', tags: [], backstory: 'b',
  characters: [], lorePieces: [], settings: { isPublic: false }, ...over,
});

test('R3: a user cannot overwrite another user\'s persona', async () => {
  const a = await srv.register();
  const b = await srv.register();
  const id = randomUUID();
  await srv.request('POST', '/api/personas', { token: a.token, body: { id, name: 'Alice', description: 'mine', avatar: PNG } });
  const before = (await srv.request('GET', '/api/personas', { token: a.token })).json.find(p => p.id === id);
  const avatarFile = path.join(srv.uploads, before.avatar.replace('/api/images/', ''));

  const r = await srv.request('POST', '/api/personas', { token: b.token, body: { id, name: 'Hacked', description: 'x', avatar: PNG } });
  assert.equal(r.status, 403);

  const after = (await srv.request('GET', '/api/personas', { token: a.token })).json.find(p => p.id === id);
  assert.equal(after.name, 'Alice');
  assert.equal(after.description, 'mine');
  assert.ok(fs.existsSync(avatarFile), "A's avatar file was deleted");
});

test('R3: a scenario cannot take over another scenario\'s character or lore', async () => {
  const a = await srv.register();
  const b = await srv.register();
  const charId = randomUUID();
  const loreId = randomUUID();
  const sa = scenarioBody({
    characters: [{ id: charId, name: 'Hero', description: 'A', personality: 'brave' }],
    lorePieces: [{ id: loreId, type: 'other', title: 'Lore', content: 'secret', triggers: [] }],
  });
  assert.equal((await srv.request('POST', '/api/scenarios', { token: a.token, body: sa })).status, 200);

  const sb1 = scenarioBody({ characters: [{ id: charId, name: 'Stolen', description: 'B', personality: '' }] });
  assert.equal((await srv.request('POST', '/api/scenarios', { token: b.token, body: sb1 })).status, 409);
  const sb2 = scenarioBody({ lorePieces: [{ id: loreId, type: 'other', title: 'Stolen', content: 'x', triggers: [] }] });
  assert.equal((await srv.request('POST', '/api/scenarios', { token: b.token, body: sb2 })).status, 409);

  const got = (await srv.request('GET', `/api/scenarios/${sa.id}`, { token: a.token })).json;
  assert.equal(got.characters[0].name, 'Hero');
  assert.equal(got.lorePieces[0].title, 'Lore');
});

test('R3: invalid ids are rejected', async () => {
  const { token } = await srv.register();
  assert.equal((await srv.request('POST', '/api/personas', { token, body: { name: 'x' } })).status, 400);
  assert.equal((await srv.request('POST', '/api/scenarios', { token, body: scenarioBody({ id: '../x' }) })).status, 400);
});

test('R4: scenario introduction is sanitized on save', async () => {
  const { token } = await srv.register();
  const s = scenarioBody({ introduction: '<p>Hello</p><img src=x onerror="alert(1)"><script>alert(2)</script>' });
  assert.equal((await srv.request('POST', '/api/scenarios', { token, body: s })).status, 200);
  const got = (await srv.request('GET', `/api/scenarios/${s.id}`, { token })).json;
  assert.ok(got.introduction.includes('<p>Hello</p>'));
  assert.ok(!/onerror|<script|alert/.test(got.introduction), got.introduction);
});

test('R4: CSP does not allow inline or eval script', async () => {
  const r = await fetch(srv.base + '/');
  const csp = r.headers.get('content-security-policy') || '';
  const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src')) || '';
  assert.ok(scriptSrc, csp);
  assert.ok(!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'unsafe-eval'"), scriptSrc);
  assert.ok(csp.includes('blob:') && !csp.includes('block:'), csp);

  // Every inline script the page ships must be allowed by hash, or the page breaks
  const html = await r.text();
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hash = createHash('sha256').update(m[1]).digest('base64');
    assert.ok(scriptSrc.includes(`'sha256-${hash}'`), `inline script not allowed by CSP: ${m[1]}`);
  }
  assert.ok(!/\son[a-z]+=/i.test(html), 'index.html has inline event handlers, which the CSP blocks');
});

/** POSTs a JSON body of roughly `bytes` size; returns the status, or 'reset' if the server hung up early */
async function postSized(url, bytes, token) {
  const body = JSON.stringify({ ...scenarioBody(), padding: 'x'.repeat(bytes) });
  try {
    const r = await fetch(srv.base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
    });
    return r.status;
  } catch {
    return 'reset';
  }
}

test('images revalidate with an ETag instead of being cached forever', async () => {
  const { token } = await srv.register();
  const id = randomUUID();
  await srv.request('POST', '/api/personas', { token, body: { id, name: 'P', description: '', avatar: PNG } });
  const url = (await srv.request('GET', '/api/personas', { token })).json.find(p => p.id === id).avatar;
  const first = await fetch(srv.base + url);
  assert.equal(first.status, 200);
  assert.ok(!/immutable/.test(first.headers.get('cache-control')));
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const again = await fetch(srv.base + url, { headers: { 'If-None-Match': etag } });
  assert.equal(again.status, 304);
});

test('R5: unauthenticated requests cannot send large bodies', async () => {
  // Small-limit routes reject over 1 MB
  assert.equal(await postSized('/api/login', 2 * 1024 * 1024), 413);
  assert.equal(await postSized('/api/register', 2 * 1024 * 1024), 413);
  // Large-limit routes check login before reading the body
  for (const url of ['/api/scenarios', '/api/chats', '/api/deepseek/chat']) {
    const status = await postSized(url, 20 * 1024 * 1024);
    assert.ok(status === 401 || status === 'reset', `${url}: ${status}`);
  }
});

test('R5: logged-in users keep the larger limits where needed', async () => {
  const { token } = await srv.register();
  assert.equal(await postSized('/api/scenarios', 30 * 1024 * 1024, token), 200);
  const tooBigChat = await postSized('/api/chats', 12 * 1024 * 1024, token);
  assert.ok(tooBigChat === 413 || tooBigChat === 'reset', String(tooBigChat));
});

test('R5: errors come back as JSON, unknown API routes are 404', async () => {
  const bad = await fetch(srv.base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get('content-type'), /json/);
  const missing = await srv.request('GET', '/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.json?.error, 'Not found');
  // No JSON body at all must not crash the route
  const empty = await fetch(srv.base + '/api/login', { method: 'POST' });
  assert.equal(empty.status, 400);
});

test('R7: editing a scenario keeps its character avatars', async () => {
  const { token } = await srv.register();
  const s = scenarioBody({ characters: [{ id: randomUUID(), name: 'Hero', description: '', personality: '', avatar: PNG }] });
  assert.equal((await srv.request('POST', '/api/scenarios', { token, body: s })).status, 200);
  const saved = (await srv.request('GET', `/api/scenarios/${s.id}`, { token })).json;
  const url = saved.characters[0].avatar;
  assert.match(url, /^\/api\/images\/characters\//);

  // The editor sends the scenario back with the existing avatar URL
  const r = await srv.request('POST', '/api/scenarios', { token, body: { ...saved, name: 'Renamed' } });
  assert.equal(r.status, 200);
  assert.equal(await rawGet(url), 200, 'avatar file was deleted by the edit-save');

  // Removing the character afterwards does delete its file
  await srv.request('POST', '/api/scenarios', { token, body: { ...saved, characters: [] } });
  assert.equal(await rawGet(url), 404);
});

test('R1: referencing another user\'s image copies it instead of sharing it', async () => {
  const a = await srv.register();
  const b = await srv.register();

  const aId = randomUUID();
  const ra = await srv.request('POST', '/api/personas', {
    token: a.token, body: { id: aId, name: 'A', description: '', avatar: PNG },
  });
  assert.equal(ra.status, 200);
  const aList = await srv.request('GET', '/api/personas', { token: a.token });
  const aUrl = aList.json.find(p => p.id === aId).avatar;
  assert.match(aUrl, /^\/api\/images\/personas\//);
  const aFile = path.join(srv.uploads, aUrl.replace('/api/images/', ''));
  assert.ok(fs.existsSync(aFile));

  // B points their persona at A's image, then deletes it
  const bId = randomUUID();
  await srv.request('POST', '/api/personas', {
    token: b.token, body: { id: bId, name: 'B', description: '', avatar: aUrl },
  });
  const bList = await srv.request('GET', '/api/personas', { token: b.token });
  const bUrl = bList.json.find(p => p.id === bId).avatar;
  assert.notEqual(bUrl, aUrl, 'B should get its own copy');
  assert.equal(await rawGet(bUrl), 200);

  await srv.request('DELETE', `/api/personas/${bId}`, { token: b.token });
  assert.ok(fs.existsSync(aFile), "A's image was deleted by B");
  assert.equal(await rawGet(aUrl), 200);
});
