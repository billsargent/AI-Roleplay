/**
 * End-to-end security checks against a server running on a throwaway
 * database and uploads folder (see tests/helpers/server.js).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
