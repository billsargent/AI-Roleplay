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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the SQLite database file (stored in project root) */
const DB_PATH = path.join(__dirname, '..', 'fictionlab.sqlite');

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

  // ── Safe migration: add soft-delete columns if they don't exist ──
  try { db.exec(`ALTER TABLE scenarios ADD COLUMN deleted_at INTEGER DEFAULT NULL`); } catch {}
  try { db.exec(`ALTER TABLE chats ADD COLUMN deleted_at INTEGER DEFAULT NULL`); } catch {}
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
  user.personas = db.prepare(`SELECT * FROM personas WHERE user_id = ?`).all(id);
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
    db.prepare(`UPDATE users SET password = ? WHERE id = ?`).run(updates.password, id);
  }
  return getUserById(id);
}

/** Deletes a user and all cascade-related data (chats, scenarios, etc.) */
export function deleteUserById(id) {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}


// ─── Personas ─────────────────────────────────────────────────────────

/** Gets all personas owned by a specific user */
export function getPersonasByUserId(userId) {
  return db.prepare(`SELECT * FROM personas WHERE user_id = ?`).all(userId);
}

/**
 * Creates or updates a persona. If the persona ID exists it updates, otherwise inserts.
 * @param {Object} persona - Persona object with id, userId, name, description, avatar
 */
export function upsertPersona(persona) {
  const existing = db.prepare(`SELECT id FROM personas WHERE id = ?`).get(persona.id);
  if (existing) {
    db.prepare(`UPDATE personas SET name = ?, description = ?, avatar = ? WHERE id = ?`)
      .run(persona.name, persona.description || '', persona.avatar || '', persona.id);
  } else {
    db.prepare(`INSERT INTO personas (id, user_id, name, description, avatar) VALUES (?, ?, ?, ?, ?)`)
      .run(persona.id, persona.userId, persona.name, persona.description || '', persona.avatar || '');
  }
  return persona;
}

/**
 * Deletes a persona only if the requesting user is the owner.
 * @returns {boolean} Whether the deletion was performed
 */
export function deletePersonaById(personaId, userId) {
  const p = db.prepare(`SELECT * FROM personas WHERE id = ?`).get(personaId);
  if (!p) return false;
  if (p.user_id !== userId) return false;
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
    image: s.image,
    tags: (() => { try { return JSON.parse(s.tags); } catch { return []; } })(),
    backstory: s.backstory,
    greetingMessage: s.greeting_message,
    customInstructions: s.custom_instructions,
    settings: (() => { try { return JSON.parse(s.settings); } catch { return {}; } })(),
    createdAt: s.created_at,
  };
}

/** Gets all scenarios (admin use) — excludes soft-deleted items */
export function getAllScenarios() {
  const scenarios = db.prepare(`SELECT * FROM scenarios WHERE deleted_at IS NULL ORDER BY created_at DESC`).all();
  return scenarios.map(scenarioToCamelCase);
}

/**
 * Gets scenarios that are either public OR owned by the requesting user — excludes soft-deleted items.
 * This ensures users only see scenarios they have access to.
 */
export function getAccessibleScenarios(userId) {
  const scenarios = db.prepare(`SELECT * FROM scenarios WHERE (json_extract(settings, '$.isPublic') = 1 OR user_id = ?) AND deleted_at IS NULL ORDER BY created_at DESC`).all(userId);
  return scenarios.map(scenarioToCamelCase);
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
  scenario.characters = characters;
  scenario.lorePieces = lorePieces.map(p => ({
    ...p,
    pinned: !!p.pinned,
    smartActivation: !!p.smart_activation,
    playable: !!p.playable,
    hidden: !!p.hidden,
    triggers: JSON.parse(p.triggers || '[]'),
    linkedPieces: JSON.parse(p.linked_pieces || '[]'),
    weight: p.weight || 100,
  }));
  return scenario;
}

/**
 * Saves a scenario within a database transaction.
 * If the scenario exists it updates; otherwise inserts.
 * Then replaces all associated characters and lore pieces (delete + re-insert).
 * This atomic approach ensures data consistency.
 */
export function saveScenarioTransaction(scenario) {
  const transaction = db.transaction(() => {
    const existing = db.prepare(`SELECT id FROM scenarios WHERE id = ?`).get(scenario.id);
    const settingsJson = JSON.stringify(scenario.settings || {});
    const tagsJson = JSON.stringify(scenario.tags || []);

    if (existing) {
      db.prepare(`UPDATE scenarios SET name=?, description=?, image=?, tags=?, backstory=?, greeting_message=?, custom_instructions=?, settings=?, creator_name=? WHERE id=?`)
        .run(
          scenario.name, scenario.description || '', scenario.image || '', tagsJson,
          scenario.backstory || '', scenario.greetingMessage || '', scenario.customInstructions || '',
          settingsJson, scenario.creatorName || '', scenario.id
        );
    } else {
      db.prepare(`INSERT INTO scenarios (id, user_id, creator_name, name, description, image, tags, backstory, greeting_message, custom_instructions, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          scenario.id, scenario.userId, scenario.creatorName || '', scenario.name, scenario.description || '',
          scenario.image || '', tagsJson, scenario.backstory || '', scenario.greetingMessage || '',
          scenario.customInstructions || '', settingsJson, scenario.createdAt || Date.now()
        );
    }

    // Replace all characters for this scenario (delete old, insert new)
    db.prepare(`DELETE FROM characters WHERE scenario_id = ?`).run(scenario.id);
    if (scenario.characters && scenario.characters.length > 0) {
      const insertChar = db.prepare(`INSERT OR REPLACE INTO characters (id, scenario_id, name, description, personality, avatar) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const c of scenario.characters) {
        insertChar.run(c.id, scenario.id, c.name, c.description || '', c.personality || '', c.avatar || '');
      }
    }

    // Replace all lore pieces for this scenario
    db.prepare(`DELETE FROM lore_pieces WHERE scenario_id = ?`).run(scenario.id);
    if (scenario.lorePieces && scenario.lorePieces.length > 0) {
      const insertLore = db.prepare(`INSERT OR REPLACE INTO lore_pieces (id, scenario_id, type, title, content, weight, pinned, smart_activation, triggers, linked_pieces, playable, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const p of scenario.lorePieces) {
        insertLore.run(
          p.id, scenario.id, p.type || 'other', p.title || '', p.content || '', p.weight || 100,
          p.pinned ? 1 : 0, p.smartActivation ? 1 : 0,
          JSON.stringify(p.triggers || []), JSON.stringify(p.linkedPieces || []),
          p.playable ? 1 : 0, p.hidden ? 1 : 0
        );
      }
    }
  });

  transaction();
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

/** Permanently deletes a scenario from the database (final deletion after trash) */
export function permanentlyDeleteScenarioById(id) {
  // Orphan all chats referencing this scenario so they remain accessible in read-only mode
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id = ?`).run(id);
  // Then safely delete the scenario (no cascade — FK was removed)
  db.prepare(`DELETE FROM scenarios WHERE id = ?`).run(id);
}

/** Permanently deletes all soft-deleted scenarios for a user (empties trash) */
export function emptyScenarioTrashByUserId(userId) {
  // Orphan all chats referencing these scenarios so they remain accessible in read-only mode
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id IN (SELECT id FROM scenarios WHERE user_id = ? AND deleted_at IS NOT NULL)`).run(userId);
  db.prepare(`DELETE FROM scenarios WHERE user_id = ? AND deleted_at IS NOT NULL`).run(userId);
}

/** Permanently deletes scenarios that have been in the trash for more than the specified number of days */
export function purgeExpiredScenarioTrash(daysOld = 30) {
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
  // Orphan all chats referencing expired scenarios first
  db.prepare(`UPDATE chats SET scenario_id = NULL WHERE scenario_id IN (SELECT id FROM scenarios WHERE deleted_at IS NOT NULL AND deleted_at < ?)`).run(cutoff);
  db.prepare(`DELETE FROM scenarios WHERE deleted_at IS NOT NULL AND deleted_at < ?`).run(cutoff);
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
    messages,
    memories,
  };
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
      const insertMsg = db.prepare(`INSERT INTO messages (id, chat_id, role, content, timestamp, character_name, versions) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const m of chat.messages) {
        insertMsg.run(
          m.id, chat.id, m.role, m.content || '', m.timestamp || Date.now(),
          m.characterName || '', JSON.stringify(m.versions || [])
        );
      }
    }

    // Replace all memories for this chat
    if (chat.memories) {
      db.prepare(`DELETE FROM memories WHERE chat_id = ?`).run(chat.id);
      const insertMem = db.prepare(`INSERT INTO memories (id, chat_id, content, pinned, timestamp) VALUES (?, ?, ?, ?, ?)`);
      for (const m of chat.memories) {
        insertMem.run(m.id, chat.id, m.content || '', m.pinned ? 1 : 0, m.timestamp || Date.now());
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
  db.prepare(`DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?`).run(cutoff);
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
