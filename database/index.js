import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'fictionlab.sqlite');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

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
      scenario_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      user_character TEXT DEFAULT '{}',
      settings TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
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
  `);
}

// ============= Users =============

export function createUser(user) {
  const stmt = db.prepare(`INSERT INTO users (id, username, password, role, created_at) VALUES (?, ?, ?, ?, ?)`);
  stmt.run(user.id, user.username, user.password, user.role, user.createdAt || user.created_at || Date.now());
  return user;
}

export function getUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE LOWER(username) = LOWER(?)`).get(username);
}

export function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

export function getUserWithPersonas(id) {
  const user = db.prepare(`SELECT id, username, role, created_at FROM users WHERE id = ?`).get(id);
  if (!user) return null;
  user.personas = db.prepare(`SELECT * FROM personas WHERE user_id = ?`).all(id);
  return user;
}

// ============= Personas =============

export function getPersonasByUserId(userId) {
  return db.prepare(`SELECT * FROM personas WHERE user_id = ?`).all(userId);
}

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

export function deletePersonaById(personaId, userId) {
  const p = db.prepare(`SELECT * FROM personas WHERE id = ?`).get(personaId);
  if (!p) return false;
  if (p.user_id !== userId) return false;
  db.prepare(`DELETE FROM personas WHERE id = ?`).run(personaId);
  return true;
}

// ============= Scenarios =============

export function getAllScenarios() {
  return db.prepare(`SELECT * FROM scenarios ORDER BY created_at DESC`).all();
}

export function getScenarioById(id) {
  const scenario = db.prepare(`SELECT * FROM scenarios WHERE id = ?`).get(id);
  if (!scenario) return null;
  scenario.characters = db.prepare(`SELECT * FROM characters WHERE scenario_id = ?`).all(id);
  scenario.lorePieces = db.prepare(`SELECT * FROM lore_pieces WHERE scenario_id = ?`).all(id);
  // Parse JSON fields
  try { scenario.tags = JSON.parse(scenario.tags); } catch { scenario.tags = []; }
  try { scenario.settings = JSON.parse(scenario.settings); } catch { scenario.settings = {}; }
  try {
    scenario.lorePieces = scenario.lorePieces.map(p => ({
      ...p,
      pinned: !!p.pinned,
      smartActivation: !!p.smartActivation,
      playable: !!p.playable,
      hidden: !!p.hidden,
      triggers: JSON.parse(p.triggers || '[]'),
      linkedPieces: JSON.parse(p.linked_pieces || '[]'),
      weight: p.weight || 100,
    }));
  } catch { }
  return scenario;
}

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

    // Replace characters
    db.prepare(`DELETE FROM characters WHERE scenario_id = ?`).run(scenario.id);
    if (scenario.characters && scenario.characters.length > 0) {
      const insertChar = db.prepare(`INSERT INTO characters (id, scenario_id, name, description, personality, avatar) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const c of scenario.characters) {
        insertChar.run(c.id, scenario.id, c.name, c.description || '', c.personality || '', c.avatar || '');
      }
    }

    // Replace lore pieces
    db.prepare(`DELETE FROM lore_pieces WHERE scenario_id = ?`).run(scenario.id);
    if (scenario.lorePieces && scenario.lorePieces.length > 0) {
      const insertLore = db.prepare(`INSERT INTO lore_pieces (id, scenario_id, type, title, content, weight, pinned, smart_activation, triggers, linked_pieces, playable, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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

export function deleteScenarioById(id) {
  db.prepare(`DELETE FROM scenarios WHERE id = ?`).run(id);
}

// ============= Chats =============

export function getChatsByUserId(userId) {
  const chats = db.prepare(`SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  return chats.map(chat => enrichChat(chat));
}

export function getChatById(chatId) {
  const chat = db.prepare(`SELECT * FROM chats WHERE id = ?`).get(chatId);
  return chat ? enrichChat(chat) : null;
}

function enrichChat(chat) {
  chat.messages = db.prepare(`SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC`).all(chat.id);
  chat.memories = db.prepare(`SELECT * FROM memories WHERE chat_id = ? ORDER BY timestamp ASC`).all(chat.id);
  try { chat.userCharacter = JSON.parse(chat.user_character); } catch { chat.userCharacter = null; }
  try { chat.settings = JSON.parse(chat.settings); } catch { chat.settings = {}; }
  delete chat.user_character;
  return chat;
}

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

    // Replace messages
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

    // Replace memories
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

export function deleteChatById(chatId) {
  db.prepare(`DELETE FROM chats WHERE id = ?`).run(chatId);
}

// ============= System Settings =============

export function getSystemSetting(key) {
  const row = db.prepare(`SELECT value FROM system_settings WHERE key = ?`).get(key);
  return row ? row.value : '';
}

export function setSystemSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)`).run(key, value);
}

// ============= Seed Default Scenarios =============

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
