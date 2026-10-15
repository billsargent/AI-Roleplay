/**
 * Data-layer tests against a throwaway database and uploads folder
 * (part of #8: image storage, orphan files, trash purge, migration script).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpchat-db-'));
process.env.DB_PATH = path.join(dir, 'test.sqlite');
process.env.UPLOADS_DIR = path.join(dir, 'uploads');

// Imported after the env is set: both modules read it when they load
const dbm = await import('../database/index.js');
const images = await import('../database/images.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const PNG_AS_JPEG = PNG.replace('image/png', 'image/jpeg');
const exists = (rel) => fs.existsSync(path.join(process.env.UPLOADS_DIR, rel));
const urlToRel = (url) => url.replace('/api/images/', '');

let db, userId;
before(() => {
  db = dbm.getDb();
  images.ensureUploadsDirs();
  userId = randomUUID();
  dbm.createUser({ id: userId, username: 'tester', password: 'x', role: 'user', createdAt: Date.now() });
});
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const scenario = (over = {}) => ({
  id: randomUUID(), userId, name: 'S', description: 'd', tags: [], backstory: 'b',
  characters: [], lorePieces: [], settings: {}, ...over,
});

test('saveImage checks the real bytes and names the file from them', () => {
  const id = randomUUID();
  const rel = images.saveImage(PNG_AS_JPEG, 'personas', id);
  assert.ok(rel.endsWith('.png'), rel);
  assert.equal(images.saveImage('data:image/png;base64,' + Buffer.from('<html>').toString('base64'), 'personas', id), null);
  assert.equal(images.saveImage('data:image/png;base64,', 'personas', id), null);
});

test('base64 is not kept in the database once a file exists', () => {
  const s = scenario({ image: PNG, characters: [{ id: randomUUID(), name: 'C', description: '', personality: '', avatar: PNG }] });
  dbm.saveScenarioTransaction(s);
  const row = db.prepare('SELECT image, image_path FROM scenarios WHERE id = ?').get(s.id);
  assert.equal(row.image, '');
  assert.ok(row.image_path);
  const ch = db.prepare('SELECT avatar, avatar_path FROM characters WHERE scenario_id = ?').get(s.id);
  assert.equal(ch.avatar, '');
  assert.ok(ch.avatar_path);
  // Web URLs are still stored as-is
  const s2 = scenario({ image: 'https://images.unsplash.com/photo-1' });
  dbm.saveScenarioTransaction(s2);
  assert.equal(db.prepare('SELECT image FROM scenarios WHERE id = ?').get(s2.id).image, 'https://images.unsplash.com/photo-1');
});

test('intro images removed from the text are deleted; other scenarios\' images are not', () => {
  const s = scenario({ introduction: `<p>a</p><img src="${PNG}"><img src="${PNG_AS_JPEG.replace('AAAAC0l', 'AAAAC0m')}">` });
  dbm.saveScenarioTransaction(s);
  const intro = db.prepare('SELECT introduction FROM scenarios WHERE id = ?').get(s.id).introduction;
  const urls = intro.match(/\/api\/images\/embedded\/[^"]+/g);
  assert.equal(urls.length, 2, intro);
  urls.forEach(u => assert.ok(exists(urlToRel(u)), u));

  // Another scenario that references s's image must not be able to delete it
  const other = scenario({ introduction: `<img src="${urls[0]}">` });
  dbm.saveScenarioTransaction(other);
  dbm.saveScenarioTransaction({ ...other, introduction: '<p>gone</p>' });
  assert.ok(exists(urlToRel(urls[0])), "another scenario's edit deleted s's image");

  // Removing one image from s deletes only that file
  dbm.saveScenarioTransaction({ ...s, introduction: `<p>a</p><img src="${urls[0]}">` });
  assert.ok(exists(urlToRel(urls[0])));
  assert.ok(!exists(urlToRel(urls[1])), 'removed intro image was left behind');
});

test('deleting a user removes their image files', () => {
  const uid = randomUUID();
  dbm.createUser({ id: uid, username: 'leaving', password: 'x', role: 'user', createdAt: Date.now() });
  const pid = randomUUID();
  dbm.upsertPersona({ id: pid, userId: uid, name: 'P', description: '', avatar: PNG });
  const s = scenario({ userId: uid, image: PNG, introduction: `<img src="${PNG}">` });
  dbm.saveScenarioTransaction(s);
  const files = [
    db.prepare('SELECT avatar_path p FROM personas WHERE id = ?').get(pid).p,
    db.prepare('SELECT image_path p FROM scenarios WHERE id = ?').get(s.id).p,
    urlToRel(db.prepare('SELECT introduction i FROM scenarios WHERE id = ?').get(s.id).i.match(/\/api\/images\/[^"]+/)[0]),
  ];
  files.forEach(f => assert.ok(exists(f), f));
  dbm.deleteUserById(uid);
  files.forEach(f => assert.ok(!exists(f), `left behind: ${f}`));
});

test('trash purge deletes only items older than the retention period, with their files', () => {
  const old = scenario({ image: PNG });
  const recent = scenario({ image: PNG });
  dbm.saveScenarioTransaction(old);
  dbm.saveScenarioTransaction(recent);
  const oldFile = db.prepare('SELECT image_path p FROM scenarios WHERE id = ?').get(old.id).p;
  db.prepare('UPDATE scenarios SET deleted_at = ? WHERE id = ?').run(Date.now() - 31 * 864e5, old.id);
  db.prepare('UPDATE scenarios SET deleted_at = ? WHERE id = ?').run(Date.now() - 2 * 864e5, recent.id);

  const removed = dbm.purgeExpiredScenarioTrash(30);
  assert.equal(removed, 1);
  assert.equal(db.prepare('SELECT 1 FROM scenarios WHERE id = ?').get(old.id), undefined);
  assert.ok(db.prepare('SELECT 1 FROM scenarios WHERE id = ?').get(recent.id));
  assert.ok(!exists(oldFile));
});

test('migration dry run changes nothing; live run backs up, extracts and clears leftovers', () => {
  // A legacy row: base64 only, no file
  const legacy = randomUUID();
  db.prepare(`INSERT INTO scenarios (id, user_id, name, description, image, tags, backstory, settings, created_at)
              VALUES (?, ?, 'L', '', ?, '[]', '', '{}', ?)`).run(legacy, userId, PNG, Date.now());
  // A row the app saved before this fix: file exists but base64 copy left behind
  const leftover = scenario({ image: PNG });
  dbm.saveScenarioTransaction(leftover);
  db.prepare('UPDATE scenarios SET image = ? WHERE id = ?').run(PNG, leftover.id);

  const countFiles = () => fs.readdirSync(process.env.UPLOADS_DIR, { recursive: true }).length;
  const run = (args) => execFileSync(process.execPath, ['scripts/migrate-images.js', ...args], {
    cwd: ROOT, env: process.env, encoding: 'utf8',
  });

  const filesBefore = countFiles();
  run(['--dry-run']);
  assert.equal(countFiles(), filesBefore, 'dry run wrote files');
  assert.equal(db.prepare('SELECT image FROM scenarios WHERE id = ?').get(legacy).image, PNG);
  assert.equal(db.prepare('SELECT image FROM scenarios WHERE id = ?').get(leftover.id).image, PNG);

  run([]);
  const l = db.prepare('SELECT image, image_path FROM scenarios WHERE id = ?').get(legacy);
  assert.equal(l.image, '');
  assert.ok(l.image_path && exists(l.image_path));
  assert.equal(db.prepare('SELECT image FROM scenarios WHERE id = ?').get(leftover.id).image, '');
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('test.sqlite.backup-')), 'no backup written');
});

test('chats round-trip with the shapes the frontend types describe', () => {
  const chatId = randomUUID();
  const s = scenario();
  dbm.saveScenarioTransaction(s);
  const chat = {
    id: chatId, userId, scenarioId: s.id, title: 't', settings: {}, createdAt: Date.now(),
    messages: [
      { id: randomUUID(), role: 'user', content: 'hi', timestamp: 1 },
      { id: randomUUID(), role: 'assistant', content: 'b', timestamp: 2, characterName: 'Oracle', versions: ['a', 'b'], currentVersionIndex: 1 },
    ],
    memories: [{ id: randomUUID(), content: 'm', pinned: true, timestamp: 3 }],
  };
  dbm.saveChatTransaction(chat);
  const got = dbm.getChatById(chatId);
  assert.deepEqual(got.messages[1].versions, ['a', 'b']);
  assert.equal(got.messages[1].currentVersionIndex, 1);
  assert.equal(got.messages[1].characterName, 'Oracle');
  assert.equal(got.messages[1].character_name, undefined, 'raw column names leaked');
  assert.equal(got.memories[0].pinned, true);

  // Saving what was loaded must not re-encode versions (it used to grow on every save)
  dbm.saveChatTransaction(got);
  dbm.saveChatTransaction(dbm.getChatById(chatId));
  assert.equal(db.prepare('SELECT versions FROM messages WHERE chat_id = ? AND role = ?').get(chatId, 'assistant').versions, '["a","b"]');

  // Rows already double-encoded by older saves are repaired when read
  db.prepare(`UPDATE messages SET versions = ? WHERE chat_id = ? AND role = 'user'`).run(JSON.stringify(JSON.stringify(['x'])), chatId);
  assert.deepEqual(dbm.getChatById(chatId).messages[0].versions, ['x']);
});
