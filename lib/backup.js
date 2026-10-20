/**
 * ─── System backup and restore ───
 *
 * A backup is one uncompressed tar file (pictures are already compressed):
 *   backup.json        what the backup holds (app, format, date, counts)
 *   database.sqlite    a consistent copy of the database (SQLite online backup)
 *   uploads/...        every stored picture, by its path under the uploads folder
 *
 * Restoring checks the file first (tar checksums, manifest, the database
 * opens and has the app's tables), extracts it to a staging folder, and only
 * then swaps the database and pictures in. A failed swap is rolled back.
 * The tar reader and writer are small and plain (ustar), so no dependency.
 *
 * @module backup
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

export const BACKUP_APP = 'rp-chat';
export const BACKUP_FORMAT = 1;
const BLOCK = 512;
const CHUNK = 1024 * 1024;
const DB_ENTRY = 'database.sqlite';
const MANIFEST_ENTRY = 'backup.json';
const UPLOADS_PREFIX = 'uploads/';
/** Tables a restored database must have */
const REQUIRED_TABLES = ['users', 'scenarios', 'chats', 'system_settings'];

/** Backup file names the server accepts (no folders, no hidden files) */
export const isBackupName = (name) => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.tar$/.test(name) && path.basename(name) === name;

/** rpchat-backup-2026-10-20T15-04-05Z[-label].tar */
export function backupFileName(label = '', date = new Date()) {
  const stamp = date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  const tag = String(label).replace(/[^a-z0-9-]/gi, '').slice(0, 30);
  return `rpchat-backup-${stamp}${tag ? `-${tag}` : ''}.tar`;
}

// ── automatic backups ──

/** Label of backups made by the nightly schedule */
export const AUTO_LABEL = 'auto';

/** Schedule settings with defaults: on, at 03:00 server time, keeping 7 */
export function readSchedule(getSetting) {
  const int = (key) => { const v = String(getSetting(key) ?? '').trim(); return v === '' ? NaN : Number(v); };
  const hour = int('autoBackupHour');
  const keep = int('autoBackupKeep');
  return {
    enabled: getSetting('autoBackupEnabled') !== 'false',
    hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 3,
    keep: Number.isInteger(keep) && keep >= 1 && keep <= 60 ? keep : 7,
    last: Number(getSetting('autoBackupLast')) || 0,
  };
}

/**
 * Whether the nightly backup should run now: once per day, at or after the
 * hour (server time). A server that was off at that hour catches up later that day.
 */
export function autoBackupDue({ enabled, hour, last }, now = new Date()) {
  if (!enabled) return false;
  const slot = new Date(now);
  slot.setHours(hour, 0, 0, 0);
  return now >= slot && last < slot.getTime();
}

/** Automatic backups beyond the newest `keep` (other backups are never pruned) */
export function backupsToPrune(names, keep) {
  return names.filter(n => isBackupName(n) && n.endsWith(`-${AUTO_LABEL}.tar`)).sort().reverse().slice(keep);
}

// ── tar writing ──

/** Writes an octal number into a header field (digits, then NUL) */
function octal(buf, offset, length, value) {
  buf.write(value.toString(8).padStart(length - 1, '0') + '\0', offset, length, 'ascii');
}

/** A ustar header; long names are split into prefix/name at a slash */
function tarHeader(name, size, mtime) {
  const header = Buffer.alloc(BLOCK);
  let prefix = '';
  let base = name;
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', name.length - 1);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
    if (cut < 0 || Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Path too long for a backup: ${name}`);
  }
  header.write(base, 0, 100, 'utf8');
  octal(header, 100, 8, 0o644);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, Math.floor(mtime / 1000));
  header.fill(' ', 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return header;
}

/** Appends files to a tar opened for writing */
class TarWriter {
  constructor(handle) { this.handle = handle; }

  async addBuffer(name, data, mtime = Date.now()) {
    await this.handle.write(tarHeader(name, data.length, mtime));
    await this.handle.write(data);
    await this.pad(data.length);
  }

  async addFile(name, file) {
    const stat = await fsp.stat(file);
    await this.handle.write(tarHeader(name, stat.size, stat.mtimeMs));
    const src = await fsp.open(file, 'r');
    try {
      const buf = Buffer.allocUnsafe(CHUNK);
      let left = stat.size;
      while (left > 0) {
        const { bytesRead } = await src.read(buf, 0, Math.min(CHUNK, left), null);
        if (bytesRead === 0) throw new Error(`File changed while it was backed up: ${name}`);
        await this.handle.write(buf.subarray(0, bytesRead));
        left -= bytesRead;
      }
    } finally {
      await src.close();
    }
    await this.pad(stat.size);
  }

  async pad(size) {
    const rest = size % BLOCK;
    if (rest) await this.handle.write(Buffer.alloc(BLOCK - rest));
  }

  async finish() { await this.handle.write(Buffer.alloc(BLOCK * 2)); }
}

// ── tar reading ──

const field = (buf, start, length) => {
  const s = buf.subarray(start, start + length);
  const end = s.indexOf(0);
  return s.subarray(0, end < 0 ? length : end).toString('utf8');
};

/**
 * Lists the entries of a tar file.
 * @returns {Promise<Array<{ name: string, size: number, offset: number }>>} offset of the data
 * @throws {Error} when the file is not a valid tar
 */
export async function listEntries(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const { size: total } = await handle.stat();
    const entries = [];
    const header = Buffer.alloc(BLOCK);
    let pos = 0;
    while (pos + BLOCK <= total) {
      await handle.read(header, 0, BLOCK, pos);
      if (header.every(b => b === 0)) return entries;
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
      if (parseInt(field(header, 148, 8).trim(), 8) !== sum) throw new Error('Not a backup file (damaged or not a tar)');
      const size = parseInt(field(header, 124, 12).trim() || '0', 8);
      const prefix = field(header, 345, 155);
      const base = field(header, 0, 100);
      const type = String.fromCharCode(header[156] || 48);
      if (!Number.isFinite(size) || size < 0 || pos + BLOCK + size > total) throw new Error('Backup file is cut short');
      if (type === '0') entries.push({ name: prefix ? `${prefix}/${base}` : base, size, offset: pos + BLOCK });
      pos += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    }
    throw new Error('Backup file is cut short');
  } finally {
    await handle.close();
  }
}

/** Copies one entry's bytes to a file */
async function copyEntry(handle, entry, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const out = await fsp.open(dest, 'w');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let done = 0;
    while (done < entry.size) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(CHUNK, entry.size - done), entry.offset + done);
      if (bytesRead === 0) throw new Error('Backup file is cut short');
      await out.write(buf.subarray(0, bytesRead));
      done += bytesRead;
    }
  } finally {
    await out.close();
  }
}

// ── backup ──

/** Files under a folder, as forward-slash paths relative to it */
async function walk(root, rel = '') {
  const out = [];
  let items;
  try { items = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const item of items) {
    const child = rel ? `${rel}/${item.name}` : item.name;
    if (item.isDirectory()) out.push(...await walk(root, child));
    else if (item.isFile()) out.push(child);
  }
  return out;
}

/**
 * Writes a backup file.
 * @param {object} opts
 * @param {string} opts.outFile - the .tar to write (written as .part, renamed when complete)
 * @param {(file: string) => Promise<void>} opts.snapshotDb - writes a consistent database copy to file
 * @param {string} opts.uploadsDir - uploads root
 * @param {(rel: string) => boolean} opts.isUpload - which files under uploads belong in the backup
 * @param {object} [opts.info] - extra manifest fields (version, counts)
 * @returns {Promise<object>} the manifest
 */
export async function createBackup({ outFile, snapshotDb, uploadsDir, isUpload, info = {} }) {
  const part = `${outFile}.part`;
  const snapshot = `${outFile}.db.part`;
  try {
    await snapshotDb(snapshot);
    const uploads = (await walk(uploadsDir)).filter(isUpload).sort();
    let bytes = (await fsp.stat(snapshot)).size;
    for (const rel of uploads) bytes += (await fsp.stat(path.join(uploadsDir, rel))).size;
    const manifest = { app: BACKUP_APP, format: BACKUP_FORMAT, createdAt: new Date().toISOString(), ...info, pictures: uploads.length, bytes };

    const handle = await fsp.open(part, 'w');
    try {
      const tar = new TarWriter(handle);
      await tar.addBuffer(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2)));
      await tar.addFile(DB_ENTRY, snapshot);
      for (const rel of uploads) await tar.addFile(UPLOADS_PREFIX + rel, path.join(uploadsDir, rel));
      await tar.finish();
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsp.rename(part, outFile);
    return manifest;
  } finally {
    await fsp.rm(snapshot, { force: true });
    await fsp.rm(part, { force: true });
  }
}

// ── inspect and restore ──

/** Database file that opens and has the app's tables; returns row counts */
export function checkDatabaseFile(file) {
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const ok = db.pragma('quick_check', { simple: true });
    if (ok !== 'ok') throw new Error(`The backup's database is damaged (${ok})`);
    const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(r => r.name));
    const missing = REQUIRED_TABLES.filter(t => !tables.has(t));
    if (missing.length) throw new Error(`The backup's database is not from this app (missing ${missing.join(', ')})`);
    const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    return { users: count('users'), scenarios: count('scenarios'), chats: count('chats') };
  } catch (err) {
    if (err?.code === 'SQLITE_NOTADB') throw new Error("The backup's database is not an SQLite file");
    throw err;
  } finally {
    db?.close();
  }
}

/**
 * Reads a backup's manifest and checks its structure (not the database).
 * @returns {Promise<{ manifest: object, entries: object[] }>}
 */
export async function inspectBackup(file, isUpload) {
  const entries = await listEntries(file);
  const manifestEntry = entries.find(e => e.name === MANIFEST_ENTRY);
  if (!manifestEntry || manifestEntry.size > 64 * 1024) throw new Error('Not a backup from this app (no backup.json)');
  const handle = await fsp.open(file, 'r');
  let manifest;
  try {
    const buf = Buffer.alloc(manifestEntry.size);
    await handle.read(buf, 0, buf.length, manifestEntry.offset);
    manifest = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('Not a backup from this app (backup.json unreadable)');
  } finally {
    await handle.close();
  }
  if (manifest?.app !== BACKUP_APP) throw new Error('Not a backup from this app');
  if (manifest.format > BACKUP_FORMAT) throw new Error('This backup was made by a newer version of the app; update first');
  if (!entries.some(e => e.name === DB_ENTRY)) throw new Error('The backup has no database');
  for (const e of entries) {
    const ok = e.name === MANIFEST_ENTRY || e.name === DB_ENTRY || (e.name.startsWith(UPLOADS_PREFIX) && isUpload(e.name.slice(UPLOADS_PREFIX.length)));
    if (!ok) throw new Error(`The backup contains an unexpected file: ${e.name.slice(0, 80)}`);
  }
  return { manifest, entries };
}

/** Renames, or copies and deletes when the rename crosses drives or mounts */
async function move(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if (!['EXDEV', 'EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
    await fsp.cp(src, dest, { recursive: true, force: true });
    await fsp.rm(src, { recursive: true, force: true });
  }
}

/** Moves every item in one folder into another (works when `from` is a mount point) */
async function moveChildren(from, to) {
  await fsp.mkdir(to, { recursive: true });
  for (const name of await fsp.readdir(from).catch(() => [])) await move(path.join(from, name), path.join(to, name));
}

/**
 * Restores a backup over the running system.
 * @param {object} opts
 * @param {string} opts.file - backup .tar
 * @param {string} opts.dbPath - the live database file
 * @param {string} opts.uploadsDir - the live uploads root
 * @param {string} opts.workDir - folder for staging (same drive as the backups)
 * @param {(rel: string) => boolean} opts.isUpload
 * @param {() => void} opts.closeDb - closes the live database
 * @param {() => void} opts.openDb - reopens it (and upgrades the schema)
 * @param {() => void} [opts.afterOpen] - runs on the restored database before it is used
 * @returns {Promise<{ manifest: object, counts: object }>}
 */
export async function restoreBackup({ file, dbPath, uploadsDir, workDir, isUpload, closeDb, openDb, afterOpen = () => {} }) {
  const { manifest, entries } = await inspectBackup(file, isUpload);
  const stage = path.join(workDir, `.restore-${crypto.randomBytes(4).toString('hex')}`);
  const stagedUploads = path.join(stage, 'uploads');
  const oldUploads = path.join(stage, 'uploads-before');
  const stamp = Date.now();
  const oldDb = `${dbPath}.before-restore-${stamp}`;
  try {
    // 1. Extract and check everything before touching the live system
    const handle = await fsp.open(file, 'r');
    try {
      for (const e of entries) {
        if (e.name === DB_ENTRY) await copyEntry(handle, e, path.join(stage, DB_ENTRY));
        else if (e.name.startsWith(UPLOADS_PREFIX)) await copyEntry(handle, e, path.join(stagedUploads, ...e.name.slice(UPLOADS_PREFIX.length).split('/')));
      }
    } finally {
      await handle.close();
    }
    const counts = checkDatabaseFile(path.join(stage, DB_ENTRY));

    // 2. Swap: database file, then the pictures; undo both if anything fails
    closeDb();
    let dbMoved = false;
    let uploadsMoved = false;
    try {
      for (const ext of ['-wal', '-shm']) await fsp.rm(dbPath + ext, { force: true });
      if (fs.existsSync(dbPath)) { await move(dbPath, oldDb); dbMoved = true; }
      await move(path.join(stage, DB_ENTRY), dbPath);
      await moveChildren(uploadsDir, oldUploads);
      uploadsMoved = true;
      await moveChildren(stagedUploads, uploadsDir);
      openDb();
      afterOpen();
    } catch (err) {
      try { closeDb(); } catch { /* already closed */ }
      await fsp.rm(dbPath, { force: true });
      for (const ext of ['-wal', '-shm']) await fsp.rm(dbPath + ext, { force: true });
      if (dbMoved) await move(oldDb, dbPath);
      if (uploadsMoved) {
        for (const name of await fsp.readdir(uploadsDir).catch(() => [])) await fsp.rm(path.join(uploadsDir, name), { recursive: true, force: true });
        await moveChildren(oldUploads, uploadsDir);
      }
      openDb();
      throw err;
    }
    await fsp.rm(oldDb, { force: true });
    return { manifest, counts };
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}
