/**
 * Tests for system backup and restore (lib/backup.js, #50).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createBackup, listEntries, inspectBackup, restoreBackup, checkDatabaseFile, backupFileName, isBackupName, autoBackupDue, readSchedule, backupsToPrune } from '../lib/backup.js';

const isUpload = (rel) => /^(scenarios|characters)\/[0-9a-z]{2}\/[0-9a-z-]+\.webp$/.test(rel);

/** A small "system": database with the app's tables, and an uploads folder */
function makeSystem(root, label) {
  fs.mkdirSync(path.join(root, 'uploads', 'scenarios', 'ab'), { recursive: true });
  const dbPath = path.join(root, 'database.sqlite');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE users (id TEXT); CREATE TABLE scenarios (id TEXT, name TEXT); CREATE TABLE chats (id TEXT); CREATE TABLE system_settings (key TEXT, value TEXT);`);
  db.prepare('INSERT INTO scenarios VALUES (?, ?)').run('s1', label);
  db.close();
  fs.writeFileSync(path.join(root, 'uploads', 'scenarios', 'ab', `${label}.webp`), `picture of ${label}`);
  return { dbPath, uploadsDir: path.join(root, 'uploads') };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rpchat-backup-'));
const scenarioName = (dbPath) => { const db = new Database(dbPath, { readonly: true }); try { return db.prepare('SELECT name FROM scenarios').get().name; } finally { db.close(); } };
const snapshotOf = (dbPath) => async (file) => { const db = new Database(dbPath); try { await db.backup(file); } finally { db.close(); } };

test('backup names', () => {
  assert.match(backupFileName('before-restore', new Date('2026-10-20T15:04:05.123Z')), /^rpchat-backup-2026-10-20T15-04-05Z-before-restore\.tar$/);
  assert.equal(isBackupName('rpchat-backup-x.tar'), true);
  for (const bad of ['../x.tar', '.hidden.tar', 'x.zip', 'a/b.tar', '']) assert.equal(isBackupName(bad), false, bad);
});

test('nightly backups: due once a day at the hour, settings defaults, pruning only automatic ones', () => {
  const at = (h, m = 0, day = 20) => new Date(2026, 9, day, h, m);
  const schedule = { enabled: true, hour: 3, last: 0 };
  assert.equal(autoBackupDue(schedule, at(2, 59)), false, 'before the hour');
  assert.equal(autoBackupDue(schedule, at(3)), true);
  assert.equal(autoBackupDue({ ...schedule, last: at(3, 1).getTime() }, at(23)), false, 'already done today');
  assert.equal(autoBackupDue({ ...schedule, last: at(3, 1, 19).getTime() }, at(14)), true, 'server was off at 3: catches up');
  assert.equal(autoBackupDue({ ...schedule, enabled: false }, at(4)), false);

  assert.deepEqual(readSchedule(() => ''), { enabled: true, hour: 3, keep: 7, last: 0 });
  const set = { autoBackupEnabled: 'false', autoBackupHour: '23', autoBackupKeep: '99', autoBackupLast: '5' };
  assert.deepEqual(readSchedule(k => set[k]), { enabled: false, hour: 23, keep: 7, last: 5 }, 'keep out of range falls back');

  const names = ['rpchat-backup-2026-10-18T03-00-00Z-auto.tar', 'rpchat-backup-2026-10-19T03-00-00Z-auto.tar', 'rpchat-backup-2026-10-20T03-00-00Z-auto.tar',
    'rpchat-backup-2026-10-01T10-00-00Z.tar', 'rpchat-backup-2026-10-02T10-00-00Z-before-restore.tar'];
  assert.deepEqual(backupsToPrune(names, 2), ['rpchat-backup-2026-10-18T03-00-00Z-auto.tar']);
  assert.deepEqual(backupsToPrune(names, 7), []);
});

test('a backup holds the manifest, the database and every picture, and restores over another system', async () => {
  const dir = tmp();
  try {
    const old = makeSystem(path.join(dir, 'old'), 'old');
    // A long path exercises the ustar prefix field
    const deep = path.join(old.uploadsDir, 'characters', 'cd');
    fs.mkdirSync(deep, { recursive: true });
    const longName = `${'a1b2c3d4-'.repeat(10)}x.webp`;
    fs.writeFileSync(path.join(deep, longName), 'long');
    fs.writeFileSync(path.join(old.uploadsDir, 'notes.txt'), 'not a picture');

    const file = path.join(dir, 'b.tar');
    const manifest = await createBackup({ outFile: file, snapshotDb: snapshotOf(old.dbPath), uploadsDir: old.uploadsDir, isUpload, info: { version: '9.9.9' } });
    assert.equal(manifest.pictures, 2, 'only picture files are included');
    const names = (await listEntries(file)).map(e => e.name);
    assert.deepEqual(names, ['backup.json', 'database.sqlite', `uploads/characters/cd/${longName}`, 'uploads/scenarios/ab/old.webp']);
    assert.equal((await inspectBackup(file, isUpload)).manifest.version, '9.9.9');
    assert.deepEqual(checkDatabaseFile(old.dbPath), { users: 0, scenarios: 1, chats: 0 });

    const live = makeSystem(path.join(dir, 'live'), 'live');
    let closed = 0, opened = 0, after = 0;
    const { counts } = await restoreBackup({
      file, dbPath: live.dbPath, uploadsDir: live.uploadsDir, workDir: dir, isUpload,
      closeDb: () => closed++, openDb: () => opened++, afterOpen: () => after++,
    });
    assert.deepEqual([closed, opened, after], [1, 1, 1]);
    assert.equal(counts.scenarios, 1);
    assert.equal(scenarioName(live.dbPath), 'old');
    assert.equal(fs.readFileSync(path.join(live.uploadsDir, 'scenarios', 'ab', 'old.webp'), 'utf8'), 'picture of old');
    assert.equal(fs.existsSync(path.join(live.uploadsDir, 'scenarios', 'ab', 'live.webp')), false, 'pictures not in the backup are gone');
    assert.equal(fs.readFileSync(path.join(live.uploadsDir, 'characters', 'cd', longName), 'utf8'), 'long');
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('.restore-')), [], 'staging folder removed');
    assert.deepEqual(fs.readdirSync(path.dirname(live.dbPath)).filter(n => n.includes('before-restore')), [], 'old database removed after success');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bad files are refused and the live system is untouched', async () => {
  const dir = tmp();
  try {
    const live = makeSystem(path.join(dir, 'live'), 'live');
    const io = { dbPath: live.dbPath, uploadsDir: live.uploadsDir, workDir: dir, isUpload, closeDb: () => { throw new Error('must not close'); }, openDb: () => {} };

    // Not a tar at all
    const junk = path.join(dir, 'junk.tar');
    fs.writeFileSync(junk, Buffer.alloc(2048, 7));
    await assert.rejects(restoreBackup({ file: junk, ...io }), /damaged or not a tar/);

    // A valid backup, then damaged, cut short, or with a database that is not the app's
    const other = makeSystem(path.join(dir, 'other'), 'other');
    const good = path.join(dir, 'good.tar');
    await createBackup({ outFile: good, snapshotDb: snapshotOf(other.dbPath), uploadsDir: other.uploadsDir, isUpload });
    const bytes = fs.readFileSync(good);
    const damaged = path.join(dir, 'damaged.tar');
    fs.writeFileSync(damaged, Buffer.concat([bytes.subarray(0, 600), Buffer.from('x'), bytes.subarray(601)]));
    const cut = path.join(dir, 'cut.tar');
    fs.writeFileSync(cut, bytes.subarray(0, 1500));
    await assert.rejects(restoreBackup({ file: cut, ...io }), /cut short/);

    const wrongDb = path.join(dir, 'wrong.sqlite');
    const w = new Database(wrongDb);
    w.exec('CREATE TABLE other (x)');
    w.close();
    const wrong = path.join(dir, 'wrong.tar');
    await createBackup({ outFile: wrong, snapshotDb: snapshotOf(wrongDb), uploadsDir: other.uploadsDir, isUpload });
    await assert.rejects(restoreBackup({ file: wrong, ...io }), /not from this app/);

    // Damage inside the database bytes is caught by SQLite's check or the tar checksum
    await assert.rejects(restoreBackup({ file: damaged, ...io }));

    assert.equal(scenarioName(live.dbPath), 'live');
    assert.ok(fs.existsSync(path.join(live.uploadsDir, 'scenarios', 'ab', 'live.webp')));
    assert.equal(fs.existsSync(path.join(dir, 'good.tar.part')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed swap is rolled back', async () => {
  const dir = tmp();
  try {
    const live = makeSystem(path.join(dir, 'live'), 'live');
    const other = makeSystem(path.join(dir, 'other'), 'other');
    const file = path.join(dir, 'b.tar');
    await createBackup({ outFile: file, snapshotDb: snapshotOf(other.dbPath), uploadsDir: other.uploadsDir, isUpload });
    let opens = 0;
    await assert.rejects(restoreBackup({
      file, dbPath: live.dbPath, uploadsDir: live.uploadsDir, workDir: dir, isUpload,
      closeDb: () => {}, openDb: () => { if (++opens === 1) throw new Error('cannot open'); },
    }), /cannot open/);
    assert.equal(opens, 2, 'reopened after the rollback');
    assert.equal(scenarioName(live.dbPath), 'live');
    assert.ok(fs.existsSync(path.join(live.uploadsDir, 'scenarios', 'ab', 'live.webp')));
    assert.equal(fs.existsSync(path.join(live.uploadsDir, 'scenarios', 'ab', 'other.webp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
