/**
 * Tests for lib/sanitizeHtml.js (scenario introduction HTML).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeRichText } from '../lib/sanitizeHtml.js';

test('removes script and event handlers', () => {
  const out = sanitizeRichText(
    '<p>Hi<script>alert(1)</script></p><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>' +
    '<svg onload="alert(1)"></svg><iframe src="https://evil"></iframe><style>body{display:none}</style>' +
    '<div onclick="alert(1)">d</div><object data="x"></object><form action="x"><input></form>'
  );
  assert.ok(!/script|onerror|onload|onclick|javascript:|<svg|<iframe|<style|<object|<form|<input/i.test(out), out);
  assert.ok(out.includes('<p>Hi</p>'));
});

test('refuses non-image data URLs', () => {
  const out = sanitizeRichText('<img src="data:text/html;base64,PHNjcmlwdD4=">');
  assert.ok(!out.includes('data:text'), out);
});

test('keeps editor and import formatting', () => {
  const html =
    '<h1 class="text-center">Title</h1><h2>Sub</h2><p style="text-align: center">Centered</p>' +
    '<p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s></p>' +
    '<span style="color: rgb(255, 0, 0); background-color: #00ff00">colour</span>' +
    '<blockquote>q</blockquote><ul><li>one</li></ul><ol><li>two</li></ol>' +
    '<img src="/api/images/embedded/03/03775b48-7d76-_50d680469e64.webp" width="300">' +
    '<img src="data:image/png;base64,iVBORw0KGgo=">';
  const out = sanitizeRichText(html);
  for (const keep of [
    '<h1 class="text-center">Title</h1>', '<h2>Sub</h2>', 'text-align:center', '<strong>b</strong>',
    '<em>i</em>', '<u>u</u>', '<s>s</s>', 'color:rgb(255, 0, 0)', 'background-color:#00ff00',
    '<blockquote>q</blockquote>', '<li>one</li>', '<li>two</li>',
    'src="/api/images/embedded/03/03775b48-7d76-_50d680469e64.webp"', 'width="300"',
    'src="data:image/png;base64,iVBORw0KGgo="',
  ]) {
    assert.ok(out.includes(keep), `lost: ${keep}\n${out}`);
  }
});

test('strips layout styles and classes that could overlay the page', () => {
  const out = sanitizeRichText(
    '<div class="fixed inset-0 z-50 text-center" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;color:red">x</div>'
  );
  assert.ok(!/fixed|inset|z-50|position|z-index|top:|left:/.test(out), out);
  assert.ok(out.includes('text-center') && out.includes('color:red'), out);
});

test('links that open a new tab get noopener', () => {
  const out = sanitizeRichText('<a href="https://example.com" target="_top">x</a>');
  assert.ok(out.includes('target="_blank"') && out.includes('rel="noopener noreferrer"'), out);
});

test('handles empty and non-string input', () => {
  assert.equal(sanitizeRichText(''), '');
  assert.equal(sanitizeRichText(undefined), '');
  assert.equal(sanitizeRichText(42), '');
});

test('keeps Quill alignment classes from imports, drops Quill font classes', () => {
  const out = sanitizeRichText('<p class="ql-align-center ql-font-Cinzel">x</p><p class="ql-indent-2 ql-direction-rtl">y</p>');
  assert.ok(out.includes('class="ql-align-center"'), out);
  assert.ok(out.includes('ql-indent-2') && out.includes('ql-direction-rtl'), out);
  assert.ok(!out.includes('ql-font'), out);
});
