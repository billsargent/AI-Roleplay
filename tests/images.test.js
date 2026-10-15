/**
 * Tests for image path validation in database/images.js.
 * Run with: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidImagePath,
  isValidEntityId,
  absolutePath,
  imagePathFromUrl,
  adoptImage,
  readImage,
  saveImage,
  parseDataUrl,
} from '../database/images.js';

const GOOD = 'scenarios/a1/a1b2c3d4-0000-4000-8000-000000000000.webp';

test('accepts the storage layout', () => {
  assert.equal(isValidImagePath(GOOD), true);
  assert.equal(isValidImagePath('embedded/03/03775b48-7d76-_50d680469e64.webp'), true);
  assert.equal(isValidImagePath('lore-pieces/ff/ff00.png'), true);
});

test('rejects traversal and unexpected paths', () => {
  for (const bad of [
    '../../database.sqlite',
    'scenarios/../../database.sqlite',
    'scenarios/a1/../../../.env',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'scenarios/a1/x.svg',
    'scenarios/a1/x.webp/../../y.webp',
    'other/a1/x.webp',
    'scenarios/a1/x',
    'scenarios/%2e%2e/x.webp',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isValidImagePath(bad), false, `should reject ${bad}`);
    assert.equal(absolutePath(bad), null, `absolutePath should reject ${bad}`);
    assert.equal(readImage(bad), null, `readImage should reject ${bad}`);
  }
});

test('absolutePath stays inside the uploads folder', () => {
  const abs = absolutePath(GOOD);
  assert.ok(abs && abs.includes('uploads'));
});

test('imagePathFromUrl only accepts valid /api/images/ URLs', () => {
  assert.equal(imagePathFromUrl('/api/images/' + GOOD), GOOD);
  assert.equal(imagePathFromUrl('/api/images/../../database.sqlite'), null);
  assert.equal(imagePathFromUrl('https://example.com/x.webp'), null);
  assert.equal(imagePathFromUrl(42), null);
});

test('entity ids must be safe file names', () => {
  assert.equal(isValidEntityId('a1b2c3d4-0000-4000-8000-000000000000'), true);
  assert.equal(isValidEntityId('../../x'), false);
  assert.equal(isValidEntityId('a/b'), false);
  assert.equal(isValidEntityId(''), false);
});

test('saveImage refuses unsafe ids and SVG without touching disk', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(saveImage(png, 'personas', '../../evil'), null);
  assert.equal(saveImage(png, 'not-a-type', 'a1b2'), null);
  assert.equal(saveImage('data:image/svg+xml;base64,PHN2Zz4=', 'personas', 'a1b2'), null);
  assert.equal(parseDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
});

test('adoptImage keeps own paths and rejects invalid ones', () => {
  const id = 'a1b2c3d4-0000-4000-8000-000000000000';
  // A URL that already belongs to this entity is kept as-is
  assert.equal(adoptImage('/api/images/' + GOOD, 'scenarios', id), GOOD);
  // Traversal is rejected
  assert.equal(adoptImage('/api/images/../../database.sqlite', 'scenarios', id), null);
  // Another entity's file that does not exist cannot be copied
  assert.equal(adoptImage('/api/images/scenarios/ff/ff000000-0000-4000-8000-000000000000.webp', 'scenarios', id), null);
  // Unsafe destination id is rejected
  assert.equal(adoptImage('/api/images/' + GOOD, 'scenarios', '../x'), null);
});
