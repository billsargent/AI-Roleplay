/**
 * Database Layer — SQLite Interface
 * 
 * Manages all database operations using better-sqlite3 (synchronous SQLite driver).
 * Handles table creation, CRUD operations for all entities, and data seeding.
 * Uses WAL mode for better concurrent read performance and foreign key enforcement.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { sanitizeRichText } from '../lib/sanitizeHtml.js';
import { saveImage, deleteImage, copyImage, resolveImageUrl, parseDataUrl, relativePath, adoptImage, imagePathFromUrl, isValidEntityId } from './images.js';

/**
 * An error caused by the request data (not a server fault).
 * Routes return `status` and `message` to the client.
 */
export class DataError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the SQLite database file (project root by default; DB_PATH overrides, e.g. for tests) */
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');

let db;

/**
 * Retrieves (or initializes) the database singleton.
 * Creates tables on first call if they don't exist.
 * @returns {Database} The better-sqlite3 database instance
 */
export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');    // Write-Ahead Logging for performance
    db.pragma('foreign_keys = ON');     // Enforce referential integrity
    db.pragma('busy_timeout = 5000');   // Wait for a lock (e.g. migration script) instead of failing at once
    db.pragma('synchronous = NORMAL');  // Safe with WAL; fewer fsyncs per write
    initTables();
  }
  return db;
}

/**
 * Creates all application tables if they don't already exist.
 * Tables: users, personas, scenarios, characters, lore_pieces, chats, messages, memories, system_settings, user_settings
 * All use TEXT UUIDs as primary keys. Foreign keys cascade on delete.
 */
function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      creator_name TEXT DEFAULT '',
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      backstory TEXT DEFAULT '',
      greeting_message TEXT DEFAULT '',
      custom_instructions TEXT DEFAULT '',
      settings TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      personality TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lore_pieces (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'other',
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      weight INTEGER DEFAULT 100,
      pinned INTEGER DEFAULT 0,
      smart_activation INTEGER DEFAULT 0,
      triggers TEXT DEFAULT '[]',
      linked_pieces TEXT DEFAULT '[]',
      playable INTEGER DEFAULT 0,
      hidden INTEGER DEFAULT 0,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scenario_id TEXT,
      title TEXT DEFAULT '',
      user_character TEXT DEFAULT '{}',
      settings TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT DEFAULT '',
      timestamp INTEGER NOT NULL,
      character_name TEXT DEFAULT '',
      versions TEXT DEFAULT '[]',
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      content TEXT DEFAULT '',
      pinned INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ── Column migrations (each adds the column only if it is missing) ──
  addColumnIfMissing('scenarios', 'deleted_at', 'INTEGER DEFAULT NULL');
  addColumnIfMissing('chats', 'deleted_at', 'INTEGER DEFAULT NULL');
  addColumnIfMissing('scenarios', 'introduction', "TEXT DEFAULT ''");
  // Image path columns (file-system storage)
  addColumnIfMissing('scenarios', 'image_path', "TEXT DEFAULT ''");
  addColumnIfMissing('characters', 'avatar_path', "TEXT DEFAULT ''");
  addColumnIfMissing('lore_pieces', 'avatar_path', "TEXT DEFAULT ''");
  addColumnIfMissing('personas', 'avatar_path', "TEXT DEFAULT ''");
  // Session revocation: tokens issued before this time (ms) are rejected
  addColumnIfMissing('users', 'password_changed_at', 'INTEGER DEFAULT 0');
  // Which of a message's alternative versions is shown
  addColumnIfMissing('messages', 'current_version_index', 'INTEGER DEFAULT 0');
  // Time of the last message a memory summarises (rolling memories)
  addColumnIfMissing('memories', 'covered_until', 'INTEGER DEFAULT NULL');
  // Memory details shown to players: first message covered, how it was made, last edit
  addColumnIfMissing('memories', 'covered_from', 'INTEGER DEFAULT NULL');
  addColumnIfMissing('memories', 'source', "TEXT DEFAULT ''");
  addColumnIfMissing('memories', 'edited_at', 'INTEGER DEFAULT NULL');
  // What the AI was given for a reply (memory ids, visible lore titles, omitted count)
  addColumnIfMissing('messages', 'context_info', "TEXT DEFAULT ''");
  // Imported from Fictionlab: one-line lore summaries, traits, start location,
  // hidden characters, and the source id used to match re-imports
  addColumnIfMissing('lore_pieces', 'description', "TEXT DEFAULT ''");
  addColumnIfMissing('lore_pieces', 'traits', "TEXT DEFAULT '[]'");
  addColumnIfMissing('lore_pieces', 'is_start_location', 'INTEGER DEFAULT 0');
  addColumnIfMissing('characters', 'traits', "TEXT DEFAULT '[]'");
  addColumnIfMissing('characters', 'hidden', 'INTEGER DEFAULT 0');
  addColumnIfMissing('scenarios', 'source_id', "TEXT DEFAULT ''");

  // ── Indexes for the lookups every page makes ──
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_chats_scenario ON chats(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id);
    CREATE INDEX IF NOT EXISTS idx_characters_scenario ON characters(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_lore_scenario ON lore_pieces(scenario_id);
    CREATE INDEX IF NOT EXISTS idx_scenarios_user ON scenarios(user_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_scenarios_deleted ON scenarios(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_personas_user ON personas(user_id);
  `);
}

/**
 * Adds a column when it does not exist yet. Unlike a bare ALTER wrapped in
 * try/catch, real errors (typos, locked database) are not swallowed.
 */
function addColumnIfMissing(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Value for the old image/avatar text columns. Once a file exists on disk
 * (path column set) nothing more is stored there, so base64 images stop
 * bloating the database on every save. Plain web URLs are kept.
 */
function legacyImageValue(value, filePath) {
  if (filePath) return '';
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
}

// ─── Users ────────────────────────────────────────────────────────────

/**
 * Creates a new user record in the database.
 * @param {Object} user - User object with id, username, password, role, createdAt
 * @returns {Object} The created user object
 */
export function createUser(user) {
  const stmt = db.prepare(`INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)`);
  stmt.run(user.id, user.username, user.password, user.role, user.createdAt || user.created_at || Date.now());
  return user;
}

/** Finds a user by username (case-insensitive) */
export function getUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`).get(username);
}

/** Finds a user by their UUID */
export function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

/** Gets a user with their associated personas (used by /api/users/me) */
export function getUserWithPersonas(id) {
  const user = db.prepare(`SELECT id, username, role, created_at FROM users WHERE id = ?`).get(id);
  if (!user) return null;
  const personas = db.prepare(`SELECT * FROM personas WHERE user_id = ?`).all(id);
  user.personas = personas.map(p => ({
    ...p,
    avatar: p.avatar_path ? `/api/images/${p.avatar_path.replace(/\\/g, '/')}` : (p.avatar || ''),
    avatarPath: p.avatar_path || '',
  }));
  return user;
}


/**
 * Gets all real users (excluding the internal 'system' user) ordered by creation date.
 * Each user includes a chatCount field.
 */
export function getAllUsers() {
  const users = db.prepare(`SELECT id, username, role, created_at FROM users WHERE id != 'system' ORDER BY created_at DESC`).all();
  return users.map(u => ({
    ...u,
    chatCount: db.prepare(`SELECT COUNT(*) as cnt FROM chats WHERE user_id = ?`).get(u.id).cnt,
  }));
}

/** Updates specific fields (username, role, password) on a user record */
export function updateUser(id, updates) {
  if (updates.username !== undefined) {
    db.prepare(`UPDATE users SET username = ? WHERE id = ?`).run(updates.username, id);
  }
  if (updates.role !== undefined) {
    db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(updates.role, id);
  }
  if (updates.password !== undefined) {
    // Changing the password signs the user out everywhere (see auth middleware)
    db.prepare(`UPDATE users SET password = ?, password_changed_at = ? WHERE id = ?`)
      .run(updates.password, Date.now(), id);
  }
  return getUserById(id);
}

/** Number of admin accounts (excluding the internal system user) */
export function countAdmins() {
  return db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND id != 'system'`).get().cnt;
}

/**
 * Creates a user, making them admin if they are the first real account.
 * The count and the insert run in one transaction, so two simultaneous
 * first sign-ups cannot both become admin.
 * @returns {object} The created user
 */
export function createUserFirstIsAdmin(user) {
  return db.transaction(() => {
    const { cnt } = db.prepare(`SELECT COUNT(*) AS cnt FROM users WHERE id != 'system'`).get();
    const created = { ...user, role: cnt === 0 ? 'admin' : 'user' };
    createUser(created);
    return created;
  }).immediate();
}

/** Deletes a user and all cascade-related data (chats, scenarios, etc.) */
export function deleteUserById(id) {
  // Rows cascade in the database, but image files on disk do not: collect them first
  const files = [
    ...db.prepare(`SELECT avatar_path FROM personas WHERE user_id = ?`).all(id).map(r => r.avatar_path),
    ...db.prepare(`SELECT id FROM scenarios WHERE user_id = ?`).all(id).flatMap(s => scenarioImagePaths(s.id)),
  ];
  // Other users' chats keep working (read-only) when the scenario is gone
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id IN (SELECT id FROM scenarios WHERE user_id = ?)`).run(id);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  for (const f of files) if (f) deleteImage(f);
}


// ─── Personas ─────────────────────────────────────────────────────────

/** Gets all personas owned by a specific user, resolving avatar paths to URLs */
export function getPersonasByUserId(userId) {
  const personas = db.prepare(`SELECT * FROM personas WHERE user_id = ?`).all(userId);
  return personas.map(p => ({
    ...p,
    avatar: p.avatar_path ? `/api/images/${p.avatar_path.replace(/\\/g, '/')}` : (p.avatar || ''),
    avatarPath: p.avatar_path || '',
  }));
}


/**
 * Creates or updates a persona. If the persona ID exists it updates, otherwise inserts.
 * Handles avatar extraction from base64 data URLs to file system storage.
 * @param {Object} persona - Persona object with id, userId, name, description, avatar
 */
export function upsertPersona(persona) {
  if (!isValidEntityId(persona.id)) throw new DataError('Invalid persona id', 400);
  const existing = db.prepare(`SELECT id, user_id, avatar_path FROM personas WHERE id = ?`).get(persona.id);
  // Never let one user update (or delete the avatar of) another user's persona
  if (existing && existing.user_id !== persona.userId) {
    throw new DataError('Persona not found or unauthorized', 403);
  }

  // ── Extract avatar to file system ──
  let avatarPath = existing?.avatar_path || '';
  if (persona.avatar && persona.avatar.startsWith('data:image/')) {
    const saved = saveImage(persona.avatar, 'personas', persona.id);
    if (saved) avatarPath = saved;
  } else if (persona.avatar && persona.avatar.startsWith('/api/images/')) {
    avatarPath = adoptImage(persona.avatar, 'personas', persona.id) || avatarPath;
  }

  if (existing) {
    db.prepare(`UPDATE personas SET name = ?, description = ?, avatar = ?, avatar_path = ? WHERE id = ?`)
      .run(persona.name, persona.description || '', legacyImageValue(persona.avatar, avatarPath), avatarPath, persona.id);
  } else {
    db.prepare(`INSERT INTO personas (id, user_id, name, description, avatar, avatar_path) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(persona.id, persona.userId, persona.name, persona.description || '', legacyImageValue(persona.avatar, avatarPath), avatarPath);
  }
  // Remove the previous avatar only after saving, and only if it was replaced
  // by a file with a different name (same name means it was overwritten in place)
  if (existing?.avatar_path && existing.avatar_path !== avatarPath) deleteImage(existing.avatar_path);
  return persona;
}


/**
 * Deletes a persona only if the requesting user is the owner.
 * Also cleans up the avatar file from disk.
 * @returns {boolean} Whether the deletion was performed
 */
export function deletePersonaById(personaId, userId) {
  const p = db.prepare(`SELECT * FROM personas WHERE id = ?`).get(personaId);
  if (!p) return false;
  if (p.user_id !== userId) return false;
  // Clean up avatar file
  if (p.avatar_path) deleteImage(p.avatar_path);
  db.prepare(`DELETE FROM personas WHERE id = ?`).run(personaId);
  return true;
}


// ─── Scenarios ────────────────────────────────────────────────────────

/**
 * Converts a raw snake_case scenario DB row to camelCase for the frontend.
 * Also parses JSON-stringified fields (tags, settings).
 */
function scenarioToCamelCase(s) {
  return {
    id: s.id,
    userId: s.user_id,
    creatorName: s.creator_name,
    name: s.name,
    description: s.description,
    image: s.image_path ? `/api/images/${s.image_path.replace(/\\/g, '/')}` : (s.image || ''),
    imagePath: s.image_path || '',
    tags: (() => { try { return JSON.parse(s.tags); } catch { return []; } })(),
    backstory: s.backstory,
    introduction: s.introduction || '',
    greetingMessage: s.greeting_message,
    customInstructions: s.custom_instructions,
    settings: (() => { try { return JSON.parse(s.settings); } catch { return {}; } })(),
    createdAt: s.created_at,
    sourceId: s.source_id || undefined,
  };
}

/** A JSON list of strings from a text column ([] for anything else) */
function stringList(value) {
  try {
    const v = JSON.parse(value || '[]');
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Traits as stored: trimmed strings, at most 20 */
const cleanTraits = (v) => JSON.stringify((Array.isArray(v) ? v : []).filter(x => typeof x === 'string').map(x => x.trim().slice(0, 60)).filter(Boolean).slice(0, 20));

/** Columns needed for scenario list cards (excludes heavy content fields) */
const SCENARIO_LIST_COLUMNS = `
  id, user_id, creator_name, name, description,
  image_path, tags, settings, created_at
`;

/**
 * Lightweight mapper for scenario list display — excludes heavy content
 * fields (backstory, introduction, greeting_message, custom_instructions)
 * that are not shown on explore/list cards.
 */
function scenarioToListCamelCase(s) {
  return {
    id: s.id,
    userId: s.user_id,
    creatorName: s.creator_name,
    name: s.name,
    description: s.description,
    image: s.image_path ? `/api/images/${s.image_path.replace(/\\/g, '/')}` : '',
    imagePath: s.image_path || '',
    tags: (() => { try { return JSON.parse(s.tags); } catch { return []; } })(),
    settings: (() => { try { return JSON.parse(s.settings); } catch { return {}; } })(),
    createdAt: s.created_at,
  };
}

/** Gets all scenarios (admin use) — excludes soft-deleted items */
export function getAllScenarios() {
  const scenarios = db.prepare(`SELECT ${SCENARIO_LIST_COLUMNS} FROM scenarios WHERE deleted_at IS NULL ORDER BY created_at DESC`).all();
  return scenarios.map(scenarioToListCamelCase);
}

/**
 * Gets scenarios that are either public OR owned by the requesting user — excludes soft-deleted items.
 * This ensures users only see scenarios they have access to.
 */
export function getAccessibleScenarios(userId) {
  const scenarios = db.prepare(`SELECT ${SCENARIO_LIST_COLUMNS} FROM scenarios WHERE (json_extract(settings, '$.isPublic') = 1 OR user_id = ?) AND deleted_at IS NULL ORDER BY created_at DESC`).all(userId);
  return scenarios.map(scenarioToListCamelCase);
}

/**
 * Lists scenarios with filtering, search and pagination done in SQL, so
 * search finds matches on every page and totals are correct.
 *
 * @param {object} opts
 * @param {string} opts.userId - Requesting user
 * @param {boolean} opts.isAdmin - Admins can see every scenario
 * @param {'explore'|'mine-public'|'mine-private'} [opts.tab] - Home page tab; omitted = everything the user can see
 * @param {string} [opts.q] - Search text (name, description, creator, tags)
 * @param {number} opts.limit
 * @param {number} opts.offset
 * @returns {{ scenarios: object[], total: number }}
 */
export function listScenarios({ userId, isAdmin, tab, q, limit, offset }) {
  const where = ['deleted_at IS NULL'];
  const params = [];
  const isPublic = `json_extract(settings, '$.isPublic') = 1`;

  if (tab === 'explore') {
    where.push(isPublic);
  } else if (tab === 'mine-public') {
    where.push('user_id = ?', isPublic);
    params.push(userId);
  } else if (tab === 'mine-private') {
    where.push('user_id = ?', `COALESCE(json_extract(settings, '$.isPublic'), 0) != 1`);
    params.push(userId);
  } else if (!isAdmin) {
    where.push(`(${isPublic} OR user_id = ?)`);
    params.push(userId);
  }

  const search = typeof q === 'string' ? q.trim().toLowerCase() : '';
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, m => '\\' + m)}%`;
    where.push(`(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(description) LIKE ? ESCAPE '\\' OR LOWER(creator_name) LIKE ? ESCAPE '\\' OR LOWER(tags) LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like);
  }

  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM scenarios WHERE ${whereSql}`).get(...params).cnt;
  const rows = db.prepare(`SELECT ${SCENARIO_LIST_COLUMNS} FROM scenarios WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { scenarios: rows.map(scenarioToListCamelCase), total };
}

/**
 * Name and cover image for each scenario id (including trashed ones), so
 * chat lists can label chats without loading every scenario.
 * @param {string[]} ids
 * @returns {Record<string, { name: string, image: string, deleted: boolean }>}
 */
export function getScenarioLabels(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const rows = db.prepare(`SELECT id, name, image, image_path, deleted_at FROM scenarios WHERE id IN (${unique.map(() => '?').join(',')})`).all(...unique);
  const labels = {};
  for (const r of rows) {
    labels[r.id] = {
      name: r.name,
      image: resolveImageUrl(r.image, r.image_path),
      deleted: r.deleted_at != null,
    };
  }
  return labels;
}

/**
 * Gets a full scenario by ID including characters and lore pieces — excludes soft-deleted items.
 * Lore pieces are enriched with parsed JSON and boolean conversions.
 */
export function getScenarioById(id) {
  const raw = db.prepare(`SELECT * FROM scenarios WHERE id = ? AND deleted_at IS NULL`).get(id);
  if (!raw) return null;

  const characters = db.prepare(`SELECT * FROM characters WHERE scenario_id = ?`).all(id);
  const lorePieces = db.prepare(`SELECT * FROM lore_pieces WHERE scenario_id = ?`).all(id);

  const scenario = scenarioToCamelCase(raw);
  scenario.characters = characters.map(c => ({
    ...c,
    avatar: c.avatar_path ? `/api/images/${c.avatar_path.replace(/\\/g, '/')}` : (c.avatar || ''),
    avatarPath: c.avatar_path || '',
    traits: stringList(c.traits),
    hidden: !!c.hidden,
  }));
  scenario.lorePieces = lorePieces.map(p => ({
    ...p,
    avatar: p.avatar_path ? `/api/images/${p.avatar_path.replace(/\\/g, '/')}` : (p.avatar || ''),
    avatarPath: p.avatar_path || '',
    pinned: !!p.pinned,
    smartActivation: !!p.smart_activation,
    playable: !!p.playable,
    hidden: !!p.hidden,
    triggers: JSON.parse(p.triggers || '[]'),
    linkedPieces: JSON.parse(p.linked_pieces || '[]'),
    weight: p.weight ?? 100,
    description: p.description || '',
    traits: stringList(p.traits),
    isStartLocation: !!p.is_start_location,
  }));
  return scenario;
}

/**
 * Saves a scenario within a database transaction.
 * If the scenario exists it updates; otherwise inserts.
 * Then replaces all associated characters and lore pieces (delete + re-insert).
 * This atomic approach ensures data consistency.
 *
 * Images are extracted from base64 data URLs and saved to the file system,
 * with the relative path stored in the image_path / avatar_path columns.
 * The original image/avatar fields remain (they may still hold base64 for
 * legacy data until the migration script clears them).
 */
export function saveScenarioTransaction(scenario) {
  if (!isValidEntityId(scenario.id)) throw new DataError('Invalid scenario id', 400);
  for (const item of [...(scenario.characters || []), ...(scenario.lorePieces || [])]) {
    if (!isValidEntityId(item?.id)) throw new DataError('Invalid character or lore id', 400);
  }

  // Introduction is rendered as HTML, so strip anything that can run script
  scenario.introduction = sanitizeRichText(scenario.introduction);

  const oldPaths = [];
  // Files in use before the save (cover, avatars, own embedded intro images)
  const oldScenarioPaths = scenarioImagePaths(scenario.id);
  const transaction = db.transaction(() => {
    const existing = db.prepare(`SELECT id, image_path FROM scenarios WHERE id = ?`).get(scenario.id);
    const settingsJson = JSON.stringify(scenario.settings || {});
    const tagsJson = JSON.stringify(scenario.tags || []);

    // ── Extract scenario image to file system ──
    let imagePath = existing?.image_path || '';
    if (scenario.image && scenario.image.startsWith('data:image/')) {
      // New base64 image — save to disk
      const saved = saveImage(scenario.image, 'scenarios', scenario.id);
      if (saved) {
        imagePath = saved;
        // keep image field as base64 for now (migration will clear it later)
      }
    } else if (scenario.image && scenario.image.startsWith('/api/images/')) {
      // Already a URL — validate it and make sure the file belongs to this scenario
      imagePath = adoptImage(scenario.image, 'scenarios', scenario.id) || imagePath;
    }
    // If image is a plain URL (e.g., Unsplash), keep it in image field — no file to save

    if (existing) {
      db.prepare(`UPDATE scenarios SET name=?, description=?, image=?, image_path=?, tags=?, backstory=?, introduction=?, greeting_message=?, custom_instructions=?, settings=?, creator_name=?, source_id=COALESCE(?, source_id) WHERE id=?`)
        .run(
          scenario.name, scenario.description || '', legacyImageValue(scenario.image, imagePath), imagePath, tagsJson,
          scenario.backstory || '', extractIntroImages(scenario.id, scenario.introduction), scenario.greetingMessage || '', scenario.customInstructions || '',
          settingsJson, scenario.creatorName || '', typeof scenario.sourceId === 'string' ? scenario.sourceId.slice(0, 100) : null, scenario.id
        );
    } else {
      db.prepare(`INSERT INTO scenarios (id, user_id, creator_name, name, description, image, image_path, tags, backstory, introduction, greeting_message, custom_instructions, settings, created_at, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          scenario.id, scenario.userId, scenario.creatorName || '', scenario.name, scenario.description || '',
          legacyImageValue(scenario.image, imagePath), imagePath, tagsJson, scenario.backstory || '', extractIntroImages(scenario.id, scenario.introduction), scenario.greetingMessage || '',
          scenario.customInstructions || '', settingsJson, scenario.createdAt || Date.now(),
          typeof scenario.sourceId === 'string' ? scenario.sourceId.slice(0, 100) : ''
        );
    }

    // Remember the files this scenario used before the save; any that are no
    // longer referenced afterwards are deleted once the transaction commits
    if (existing) oldPaths.push(...oldScenarioPaths);

    // Replace all characters for this scenario (delete old, insert new)
    db.prepare(`DELETE FROM characters WHERE scenario_id = ?`).run(scenario.id);
    if (scenario.characters && scenario.characters.length > 0) {
      // Plain INSERT: this scenario's rows were just deleted, so an id that still
      // exists belongs to another scenario (or is duplicated) and must not be replaced
      const insertChar = db.prepare(`INSERT INTO characters (id, scenario_id, name, description, personality, avatar, avatar_path, traits, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const charTaken = db.prepare(`SELECT 1 FROM characters WHERE id = ?`);
      for (const c of scenario.characters) {
        if (charTaken.get(c.id)) throw new DataError('Character id conflicts with an existing character', 409);
        let charAvatarPath = '';
        if (c.avatar && c.avatar.startsWith('data:image/')) {
          const saved = saveImage(c.avatar, 'characters', c.id);
          if (saved) charAvatarPath = saved;
        } else if (c.avatar && c.avatar.startsWith('/api/images/')) {
          charAvatarPath = adoptImage(c.avatar, 'characters', c.id) || '';
        }
        insertChar.run(c.id, scenario.id, c.name, c.description || '', c.personality || '', legacyImageValue(c.avatar, charAvatarPath), charAvatarPath, cleanTraits(c.traits), c.hidden ? 1 : 0);
      }
    }

    // Replace all lore pieces for this scenario
    db.prepare(`DELETE FROM lore_pieces WHERE scenario_id = ?`).run(scenario.id);
    if (scenario.lorePieces && scenario.lorePieces.length > 0) {
      const insertLore = db.prepare(`INSERT INTO lore_pieces (id, scenario_id, type, title, content, weight, pinned, smart_activation, triggers, linked_pieces, playable, hidden, avatar_path, description, traits, is_start_location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const loreTaken = db.prepare(`SELECT 1 FROM lore_pieces WHERE id = ?`);
      for (const p of scenario.lorePieces) {
        if (loreTaken.get(p.id)) throw new DataError('Lore id conflicts with an existing lore piece', 409);
        let loreAvatarPath = '';
        if (p.avatar && p.avatar.startsWith('data:image/')) {
          const saved = saveImage(p.avatar, 'lore-pieces', p.id);
          if (saved) loreAvatarPath = saved;
        } else if (p.avatar && p.avatar.startsWith('/api/images/')) {
          loreAvatarPath = adoptImage(p.avatar, 'lore-pieces', p.id) || '';
        }
        insertLore.run(
          p.id, scenario.id, String(p.type || 'other').slice(0, 40), p.title || '', p.content || '',
          Number.isFinite(Number(p.weight)) ? Math.round(Number(p.weight)) : 100,
          p.pinned ? 1 : 0, p.smartActivation ? 1 : 0,
          JSON.stringify(p.triggers || []), JSON.stringify(p.linkedPieces || []),
          p.playable ? 1 : 0, p.hidden ? 1 : 0, loreAvatarPath,
          typeof p.description === 'string' ? p.description.slice(0, 1000) : '', cleanTraits(p.traits), p.isStartLocation ? 1 : 0
        );
      }
    }
  });

  transaction();

  // Delete files that were in use before the save and are not referenced now.
  // Done after commit so a failed save never loses images.
  const stillUsed = new Set(scenarioImagePaths(scenario.id));
  for (const p of new Set(oldPaths)) {
    if (p && !stillUsed.has(p)) deleteImage(p);
  }
  return scenario;
}


/** Soft-deletes a scenario by setting deleted_at timestamp (moves to trash) */
export function deleteScenarioById(id) {
  db.prepare(`UPDATE scenarios SET deleted_at = ? WHERE id = ?`).run(Date.now(), id);
}

/** Gets all soft-deleted scenarios for a user */
export function getTrashedScenariosByUserId(userId) {
  const scenarios = db.prepare(`SELECT * FROM scenarios WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all(userId);
  return scenarios.map(scenarioToCamelCase);
}

/** Restores a soft-deleted scenario (removes from trash) */
export function restoreScenarioById(id) {
  db.prepare(`UPDATE scenarios SET deleted_at = NULL WHERE id = ?`).run(id);
}

/** Permanently deletes a scenario and all its associated image files from disk (final deletion after trash) */
export function permanentlyDeleteScenarioById(id) {
  // Clean up the cover, character/lore avatars and embedded introduction images
  cleanupScenarioImages(id);

  // Orphan all chats referencing this scenario so they remain accessible in read-only mode
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id = ?`).run(id);
  // Then safely delete the scenario (no cascade — FK was removed)
  db.prepare(`DELETE FROM scenarios WHERE id = ?`).run(id);
}


/** Permanently deletes all soft-deleted scenarios for a user (empties trash) */
export function emptyScenarioTrashByUserId(userId) {
  // Clean up image files for all trashed scenarios
  const trashed = db.prepare(`SELECT id FROM scenarios WHERE user_id = ? AND deleted_at IS NOT NULL`).all(userId);
  for (const ts of trashed) {
    cleanupScenarioImages(ts.id);
  }

  // Orphan all chats referencing these scenarios so they remain accessible in read-only mode
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id IN (SELECT id FROM scenarios WHERE user_id = ? AND deleted_at IS NOT NULL)`).run(userId);
  db.prepare(`DELETE FROM scenarios WHERE user_id = ? AND deleted_at IS NOT NULL`).run(userId);
}

/** Permanently deletes scenarios that have been in the trash for more than the specified number of days */
export function purgeExpiredScenarioTrash(daysOld = 30) {
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

  // Clean up image files for all expired scenarios
  const expired = db.prepare(`SELECT id FROM scenarios WHERE deleted_at IS NOT NULL AND deleted_at < ?`).all(cutoff);
  for (const es of expired) {
    cleanupScenarioImages(es.id);
  }

  // Orphan all chats referencing expired scenarios first
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id IN (SELECT id FROM scenarios WHERE deleted_at IS NOT NULL AND deleted_at < ?)`).run(cutoff);
  return db.prepare(`DELETE FROM scenarios WHERE deleted_at IS NOT NULL AND deleted_at < ?`).run(cutoff).changes;
}

/**
 * Helper: cleans up all image files (scenario image + character avatars + lore piece avatars)
 * associated with a given scenario ID. Used before permanent deletion.
 * @param {string} scenarioId
 */
function cleanupScenarioImages(scenarioId) {
  for (const p of scenarioImagePaths(scenarioId)) deleteImage(p);
}

/**
 * Every image file a scenario owns: cover, character and lore avatars, and
 * the embedded introduction images it created ("{id prefix}_{hash}").
 * @param {string} scenarioId
 * @returns {string[]} Relative image paths
 */
function scenarioImagePaths(scenarioId) {
  const paths = [];
  const s = db.prepare(`SELECT image_path, introduction FROM scenarios WHERE id = ?`).get(scenarioId);
  if (!s) return paths;
  paths.push(s.image_path);
  for (const r of db.prepare(`SELECT avatar_path FROM characters WHERE scenario_id = ?`).all(scenarioId)) paths.push(r.avatar_path);
  for (const r of db.prepare(`SELECT avatar_path FROM lore_pieces WHERE scenario_id = ?`).all(scenarioId)) paths.push(r.avatar_path);
  paths.push(...ownIntroImagePaths(scenarioId, s.introduction));
  return paths.filter(Boolean);
}

/** Embedded introduction images created by this scenario (never another scenario's files) */
function ownIntroImagePaths(scenarioId, introduction) {
  if (!introduction) return [];
  const ownPrefix = scenarioId.substring(0, 14) + "_";
  return (introduction.match(/\/api\/images\/embedded\/[^"'?#\s)]+/g) || [])
    .map(url => imagePathFromUrl(url))
    .filter(rel => rel && path.basename(rel).startsWith(ownPrefix));
}

/**
 * Extracts embedded base64 images from the scenario introduction (rich HTML)
 * and saves them to the file system, replacing data URLs with /api/images/ URLs.
 */
function extractIntroImages(scenarioId, introduction) {
  if (!introduction || !introduction.includes("data:image/")) {
    return introduction || "";
  }
  return introduction.replace(/<img[^>]*src="(data:image\/[^"]+)"/gi, function(match, dataUrl) {
    var parsed = parseDataUrl(dataUrl);
    if (!parsed) return match;
    var hash = crypto.createHash("md5").update(dataUrl).digest("hex");
    var embeddedId = scenarioId.substring(0, 14) + "_" + hash.substring(0, 12);
    var saved = saveImage(dataUrl, "embedded", embeddedId);
    if (saved) {
      // Use the path saveImage wrote (its extension comes from the real bytes)
      return match.replace(dataUrl, "/api/images/" + saved);
    }
    return match;
  });
}




// ─── Chats ────────────────────────────────────────────────────────────

/** Gets all chats for a specific user, enriched with messages and memories */
export function getChatsByUserId(userId) {
  const chats = db.prepare(`SELECT * FROM chats WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`).all(userId);
  return chats.map(chat => enrichChat(chat));
}

/** Gets a single chat by ID with full message/memory data */
export function getChatById(chatId) {
  const chat = db.prepare(`SELECT * FROM chats WHERE id = ? AND deleted_at IS NULL`).get(chatId);
  return chat ? enrichChat(chat) : null;
}

/**
 * Enriches a raw chat row with its messages, memories, and parsed JSON fields.
 * This is the standard transformation applied before returning chat data.
 */
function enrichChat(chat) {
  const messages = db.prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC`).all(chat.id);
  const memories = db.prepare(`SELECT * FROM memories WHERE chat_id = ? ORDER BY timestamp ASC`).all(chat.id);
  let userCharacter, settings;
  try { userCharacter = JSON.parse(chat.user_character); } catch { userCharacter = null; }
  try { settings = JSON.parse(chat.settings); } catch { settings = {}; }
  return {
    id: chat.id,
    userId: chat.user_id,
    scenarioId: chat.scenario_id,
    title: chat.title,
    userCharacter,
    settings,
    createdAt: chat.created_at,
    // Shapes match the Message / Memory types in src/types/index.ts
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      characterName: m.character_name || undefined,
      versions: parseVersions(m.versions),
      currentVersionIndex: m.current_version_index ?? 0,
      contextInfo: parseContextInfo(m.context_info),
    })),
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      pinned: !!m.pinned,
      timestamp: m.timestamp,
      coveredUntil: m.covered_until || undefined,
      coveredFrom: m.covered_from || undefined,
      source: MEMORY_SOURCES.has(m.source) ? m.source : undefined,
      editedAt: m.edited_at || undefined,
    })),
  };
}

/** How a memory was made: by the app after a reply, on request, or written by the player */
const MEMORY_SOURCES = new Set(['auto', 'manual', 'user']);

/**
 * What the AI was given for a reply, as stored with the message:
 * { memoryIds: string[], lore: string[], hiddenLore: number, omitted: number }.
 * Anything else becomes undefined (or is trimmed to these fields).
 */
function parseContextInfo(value) {
  let v = value;
  if (typeof v === 'string') {
    if (!v) return undefined;
    try { v = JSON.parse(v); } catch { return undefined; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const strings = (a, n) => (Array.isArray(a) ? a.filter(x => typeof x === 'string').slice(0, n).map(x => x.slice(0, 200)) : []);
  const count = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0);
  return { memoryIds: strings(v.memoryIds, 200), lore: strings(v.lore, 100), hiddenLore: count(v.hiddenLore), omitted: count(v.omitted) };
}

/** Live scenarios with the fields used to match re-imported files */
export function listScenarioMatchKeys() {
  return db.prepare(`SELECT id, name, source_id AS sourceId, user_id AS userId FROM scenarios WHERE deleted_at IS NULL`).all();
}

/**
 * Writes a consistent copy of the database next to it
 * ("<database file>.backup-<timestamp>") and returns its file name.
 */
export async function backupDatabase() {
  const file = `${db.name}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await db.backup(file);
  return file;
}

/** Number of pinned memories a chat has stored (for the pinned cap) */
export function countPinnedMemories(chatId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE chat_id = ? AND pinned = 1`).get(chatId).n;
}

/**
 * Message versions as an array of strings. Older saves double-encoded the
 * JSON (the raw string was sent back and stringified again), so unwrap
 * until an array appears.
 */
function parseVersions(value) {
  let v = value;
  for (let i = 0; i < 5 && typeof v === 'string'; i++) {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
}

/**
 * Saves a chat (including all its messages and memories) within a transaction.
 * Uses the same delete-then-reinsert pattern as scenarios for consistency.
 */
export function saveChatTransaction(chat) {
  const transaction = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM chats WHERE id = ?`).get(chat.id);
    const settingsJson = JSON.stringify(chat.settings || {});
    const userCharJson = JSON.stringify(chat.userCharacter || {});

    if (existing) {
      db.prepare(`UPDATE chats SET title=?, user_character=?, settings=? WHERE id=?`)
        .run(chat.title || '', userCharJson, settingsJson, chat.id);
    } else {
      db.prepare(`INSERT INTO chats (id, user_id, scenario_id, title, user_character, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(chat.id, chat.userId, chat.scenarioId, chat.title || '', userCharJson, settingsJson, chat.createdAt || Date.now());
    }

    // Replace all messages for this chat
    if (chat.messages) {
      db.prepare(`DELETE FROM messages WHERE chat_id = ?`).run(chat.id);
      const insertMsg = db.prepare(`INSERT INTO messages (id, chat_id, role, content, timestamp, character_name, versions, current_version_index, context_info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const m of chat.messages) {
        const versions = parseVersions(m.versions);
        const index = Number.isInteger(m.currentVersionIndex) ? m.currentVersionIndex : 0;
        const context = m.role === 'assistant' ? parseContextInfo(m.contextInfo) : undefined;
        insertMsg.run(
          m.id, chat.id, m.role, m.content || '', m.timestamp || Date.now(),
          m.characterName || '', JSON.stringify(versions),
          Math.min(Math.max(index, 0), Math.max(versions.length - 1, 0)),
          context ? JSON.stringify(context) : ''
        );
      }
    }

    // Replace all memories for this chat
    if (chat.memories) {
      db.prepare(`DELETE FROM memories WHERE chat_id = ?`).run(chat.id);
      const insertMem = db.prepare(`INSERT INTO memories (id, chat_id, content, pinned, timestamp, covered_until, covered_from, source, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const time = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
      for (const m of chat.memories) {
        insertMem.run(m.id, chat.id, m.content || '', m.pinned ? 1 : 0, m.timestamp || Date.now(),
          time(m.coveredUntil), time(m.coveredFrom),
          MEMORY_SOURCES.has(m.source) ? m.source : '', time(m.editedAt));
      }
    }
  });

  transaction();
  return chat;
}

/** Soft-deletes a chat by setting deleted_at timestamp (moves to trash) */
export function deleteChatById(chatId) {
  db.prepare(`UPDATE chats SET deleted_at = ? WHERE id = ?`).run(Date.now(), chatId);
}

/** Gets all soft-deleted chats for a user, enriched with messages, memories, and scenario name */
export function getTrashedChatsByUserId(userId) {
  const chats = db.prepare(`SELECT * FROM chats WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all(userId);
  return chats.map(chat => {
    const enriched = enrichChat(chat);
    // Look up scenario name (handle null/undefined scenarioId for orphaned chats)
    if (enriched.scenarioId) {
      const scenario = db.prepare(`SELECT name FROM scenarios WHERE id = ?`).get(enriched.scenarioId);
      enriched.scenarioName = scenario?.name || null;
    } else {
      enriched.scenarioName = null;
    }
    return enriched;
  });
}

/** Restores a soft-deleted chat (removes from trash) */
export function restoreChatById(chatId) {
  db.prepare(`UPDATE chats SET deleted_at = NULL WHERE id = ?`).run(chatId);
}

/** Permanently deletes a chat from the database (final deletion after trash) */
export function permanentlyDeleteChatById(chatId) {
  db.prepare(`DELETE FROM chats WHERE id = ?`).run(chatId);
}

/** Permanently deletes all soft-deleted chats for a user (empties trash) */
export function emptyChatTrashByUserId(userId) {
  db.prepare(`DELETE FROM chats WHERE user_id = ? AND deleted_at IS NOT NULL`).run(userId);
}

/** Permanently deletes chats that have been in the trash for more than the specified number of days */
export function purgeExpiredChatTrash(daysOld = 30) {
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  return db.prepare(`DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?`).run(cutoff).changes;
}

/** Deletes all chats owned by a specific user (permanent — used by "Delete All My Chats") */
export function deleteAllChatsByUserId(userId) {
  db.prepare(`DELETE FROM chats WHERE user_id = ?`).run(userId);
}


// ─── System Settings ──────────────────────────────────────────────────

/** Gets a single system setting by key */
export function getSystemSetting(key) {
  const row = db.prepare(`SELECT value FROM system_settings WHERE key = ?`).get(key);
  return row ? row.value : '';
}

/** Sets or updates a system setting (upsert via INSERT OR REPLACE) */
export function setSystemSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)`).run(key, value);
}

// ─── User Settings ────────────────────────────────────────────────────

/** Gets a specific user setting by user ID and key */
export function getUserSetting(userId, key) {
  const row = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = ?`).get(userId, key);
  return row ? row.value : '';
}

/** Sets or updates a user setting */
export function setUserSetting(userId, key, value) {
  db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`).run(userId, key, value);
}

/** Gets all settings for a user as a flat key-value object */
export function getAllUserSettings(userId) {
  const rows = db.prepare(`SELECT key, value FROM user_settings WHERE user_id = ?`).all(userId);
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ─── Seed Default Scenarios ───────────────────────────────────────────

/**
 * Seeds 2 default public scenarios (Cyberpunk + Fantasy) if no scenarios exist.
 * Creates an internal 'system' admin user if no admin exists to own them.
 * This runs once on server startup if the database is empty.
 */
export function seedDefaultScenariosIfEmpty() {
  const count = db.prepare(`SELECT COUNT(*) as cnt FROM scenarios`).get().cnt;
  if (count > 0) return;

  // If no users exist yet, create a hidden system user to own default scenarios
  let adminUser = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`).get();
  if (!adminUser) {
    db.prepare(`INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      'system', 'FictionLab', '', 'admin', Date.now()
    );
    adminUser = { id: 'system' };
  }
  const adminId = adminUser.id;
  const now = Date.now();

  const defaultScenarios = [
    {
      id: 'default-cyberpunk',
      userId: adminId,
      creatorName: 'FictionLab',
      name: 'Cyberpunk Neon Nights',
      description: 'A gritty underworld mission in the rain-slicked streets of Neo-Tokyo. Corporate intrigue and neon-lit danger await.',
      image: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?w=800&auto=format&fit=crop',
      tags: ['Cyberpunk', 'Sci-Fi', 'Action'],
      backstory: 'The year is 2084. Megacorporations rule the world from their golden towers while the rest of humanity struggles in the neon shadows. You are a mercenary for hire, specialized in high-stakes data theft.',
      greetingMessage: '*The rain drums a rhythmic beat against the window of your cramped apartment. A neon sign outside flickers, casting a harsh blue light across your desk. Your terminal pings—a new encrypted message from an anonymous sender.* "I have a job for you. High risk, higher reward. Interested?"',
      customInstructions: '',
      settings: { separateUserCharacter: true, sensitiveContent: false, isPublic: true, allowCustomization: true, hidePrompts: false, allowCommenting: true },
      createdAt: now,
      characters: [
        { id: 'c-default-1', name: 'Kaelen', description: 'A cynical street doc', personality: 'Grumpy but loyal' }
      ],
      lorePieces: []
    },
    {
      id: 'default-fantasy',
      userId: adminId,
      creatorName: 'FictionLab',
      name: 'The Forgotten Kingdom',
      description: 'Awaken in the ruins of a once-great civilization. Magic is fading, and ancient shadows are stirring in the deep.',
      image: 'https://images.unsplash.com/photo-1519074063912-ad2d6d51ee17?w=800&auto=format&fit=crop',
      tags: ['Fantasy', 'Adventure', 'Magic'],
      backstory: 'A thousand years ago, the Kingdom of Eldoria was the jewel of the world. Now, it is a land of ruins and whispers. You are a traveler who has stumbled upon the gates of the capital, guided by a strange, humming pendant.',
      greetingMessage: '*The heavy stone gates groan as they swing open, revealing a city reclaimed by nature. Vines wrap around marble pillars, and the air is thick with the scent of old magic. A figure shrouded in grey rags steps out from the shadows.* "Few come this way anymore. Do you seek the crown, or the curse?"',
      customInstructions: '',
      settings: { separateUserCharacter: true, sensitiveContent: false, isPublic: true, allowCustomization: true, hidePrompts: false, allowCommenting: true },
      createdAt: now,
      characters: [
        { id: 'c-default-2', name: 'The Oracle', description: 'A blind seer who speaks in riddles', personality: 'Mysterious and wise' }
      ],
      lorePieces: []
    }
  ];

  for (const s of defaultScenarios) {
    saveScenarioTransaction(s);
  }

  console.log('Seeded 2 default scenarios.');
}
