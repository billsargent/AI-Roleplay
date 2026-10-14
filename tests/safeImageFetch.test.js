/**
 * Tests for lib/safeImageFetch.js (SSRF protection for /api/proxy-image).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchImage, isBlockedAddress, ImageFetchError } from '../lib/safeImageFetch.js';

test('blocks private, loopback, link-local and reserved addresses', () => {
  for (const ip of [
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.2',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    'not-an-ip',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test('allows public addresses', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test('rejects non-http schemes and blocked literal hosts without connecting', async () => {
  for (const url of [
    'file:///etc/passwd',
    'ftp://example.com/x.png',
    'gopher://127.0.0.1/',
    'http://127.0.0.1/x.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/x.png',
    'http://user:pass@example.com/x.png',
    'not a url',
  ]) {
    await assert.rejects(fetchImage(url), ImageFetchError, url);
  }
});

test('rejects hostnames that resolve to a blocked address', async () => {
  await assert.rejects(fetchImage('http://localhost/x.png'), ImageFetchError);
});

// Local servers for behaviour tests. The default filter would block them,
// so these tests allow loopback only and keep everything else blocked.
const allowLoopback = ip => !(ip === '127.0.0.1' || ip === '::ffff:127.0.0.1') && isBlockedAddress(ip);

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

let srv, base;
before(async () => {
  srv = http.createServer((req, res) => {
    if (req.url === '/ok.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG_BYTES);
    }
    if (req.url === '/octet') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(PNG_BYTES);
    }
    if (req.url === '/fake.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end('<html><script>alert(1)</script></html>');
    }
    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>');
    }
    if (req.url === '/svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg/>');
    }
    if (req.url === '/big.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.concat([PNG_BYTES, Buffer.alloc(2048)]));
    }
    if (req.url === '/to-private') {
      res.writeHead(302, { Location: 'http://10.255.255.1/x.png' });
      return res.end();
    }
    if (req.url === '/to-ok') {
      res.writeHead(302, { Location: '/ok.png' });
      return res.end();
    }
    if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => new Promise(r => srv.close(r)));

test('fetches a real image', async () => {
  const r = await fetchImage(base + '/ok.png', { isBlocked: allowLoopback });
  assert.equal(r.contentType, 'image/png');
  assert.ok(r.buffer.equals(PNG_BYTES));
});

test('detects the type from the bytes, not the header', async () => {
  const r = await fetchImage(base + '/octet', { isBlocked: allowLoopback });
  assert.equal(r.contentType, 'image/png');
  await assert.rejects(fetchImage(base + '/fake.png', { isBlocked: allowLoopback }), /not a supported image/);
});

test('refuses non-image and SVG responses', async () => {
  await assert.rejects(fetchImage(base + '/page', { isBlocked: allowLoopback }), /not a supported image/);
  await assert.rejects(fetchImage(base + '/svg', { isBlocked: allowLoopback }), /not a supported image/);
});

test('enforces the size cap', async () => {
  await assert.rejects(fetchImage(base + '/big.png', { isBlocked: allowLoopback, maxBytes: 1024 }), /too large/);
});

test('re-checks every redirect hop', async () => {
  await assert.rejects(fetchImage(base + '/to-private', { isBlocked: allowLoopback }), /not allowed/);
  const ok = await fetchImage(base + '/to-ok', { isBlocked: allowLoopback });
  assert.equal(ok.contentType, 'image/png');
  await assert.rejects(fetchImage(base + '/loop', { isBlocked: allowLoopback }), /Too many redirects/);
});
