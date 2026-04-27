import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import {
  getDb,
  createUser,
  getUserByUsername,
  getUserById,
  getUserWithPersonas,
  getPersonasByUserId,
  upsertPersona,
  deletePersonaById,
  getAllScenarios,
  getScenarioById,
  saveScenarioTransaction,
  deleteScenarioById,
  getChatsByUserId,
  getChatById,
  saveChatTransaction,
  deleteChatById,
  getSystemSetting,
  setSystemSetting,
  seedDefaultScenariosIfEmpty,
} from './database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fictionlab-super-secret-key';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// Initialize database
getDb();
seedDefaultScenariosIfEmpty();

// Auth middleware
const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// Admin middleware
const adminAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (user?.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admins only' });
    }
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

// ==================== Auth Routes ====================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // First user gets admin role
    const allUsers = getDb().prepare(`SELECT COUNT(*) as cnt FROM users`).get();
    const role = allUsers.cnt === 0 ? 'admin' : 'user';

    const user = {
      id: 'u-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      username,
      password: hashedPassword,
      role,
      createdAt: Date.now(),
    };

    createUser(user);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    const { password: _, ...userWithoutPassword } = user;
    console.log(`Registered user: ${username} with role: ${role}`);
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET);
    const { password: _, ...userWithoutPassword } = user;
    console.log(`Logged in user: ${username}`);
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// ==================== User Routes ====================

app.get('/api/users/me', auth, (req, res) => {
  const user = getUserWithPersonas(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ==================== Persona Routes ====================

app.get('/api/personas', auth, (req, res) => {
  const personas = getPersonasByUserId(req.userId);
  res.json(personas);
});

app.post('/api/personas', auth, (req, res) => {
  const persona = { ...req.body, userId: req.userId };
  const saved = upsertPersona(persona);
  res.json(saved);
});

app.delete('/api/personas/:id', auth, (req, res) => {
  const deleted = deletePersonaById(req.params.id, req.userId);
  if (!deleted) return res.status(404).json({ error: 'Persona not found or unauthorized' });
  res.status(204).send();
});

// ==================== Scenario Routes ====================

app.get('/api/scenarios', (req, res) => {
  const scenarios = getAllScenarios();
  res.json(scenarios);
});

app.get('/api/scenarios/:id', (req, res) => {
  const scenario = getScenarioById(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
  res.json(scenario);
});

app.post('/api/scenarios', auth, (req, res) => {
  try {
    const scenario = req.body;
    const existing = getDb().prepare(`SELECT id, user_id FROM scenarios WHERE id = ?`).get(scenario.id);

    if (existing) {
      // Editing existing scenario — check ownership
      const isOwner = existing.user_id === req.userId;
      const existingScenario = getScenarioById(scenario.id);
      const allowsCustomization = existingScenario?.settings?.allowCustomization;
      const user = getUserById(req.userId);
      const isAdmin = user?.role === 'admin';

      if (!isOwner && !allowsCustomization && !isAdmin) {
        return res.status(403).json({ error: 'Unauthorized to edit this scenario' });
      }

      // Preserve original creator
      scenario.userId = existing.user_id;
      const original = getScenarioById(scenario.id);
      scenario.creatorName = original?.creatorName || '';
    } else {
      // New scenario
      scenario.userId = req.userId;
      const user = getUserById(req.userId);
      scenario.creatorName = user?.username || '';
      scenario.createdAt = scenario.createdAt || Date.now();
    }

    saveScenarioTransaction(scenario);
    res.json(scenario);
  } catch (err) {
    console.error('Save scenario error:', err);
    res.status(500).json({ error: 'Server error saving scenario' });
  }
});

app.delete('/api/scenarios/:id', auth, (req, res) => {
  try {
    const scenario = getDb().prepare(`SELECT id, user_id FROM scenarios WHERE id = ?`).get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const user = getUserById(req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = scenario.user_id === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to delete this scenario' });
    }

    deleteScenarioById(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Delete scenario error:', err);
    res.status(500).json({ error: 'Server error deleting scenario' });
  }
});

// ==================== Chat Routes ====================

app.get('/api/chats', auth, (req, res) => {
  const user = getUserById(req.userId);
  const isAdmin = user?.role === 'admin';

  let chats;
  if (isAdmin) {
    // Admin sees all chats for management
    chats = getDb().prepare(`SELECT * FROM chats ORDER BY created_at DESC`).all();
    chats = chats.map(chat => {
      const c = getChatById(chat.id);
      return c;
    });
    // But strip visible user details for privacy
    chats = chats.filter(Boolean);
  } else {
    // Regular user sees only their own chats
    chats = getChatsByUserId(req.userId);
  }

  res.json(chats);
});

app.post('/api/chats', auth, (req, res) => {
  try {
    const chat = req.body;
    const existing = getDb().prepare(`SELECT id, user_id FROM chats WHERE id = ?`).get(chat.id);

    if (existing) {
      // Editing — check ownership
      const isOwner = existing.user_id === req.userId;
      const user = getUserById(req.userId);
      const isAdmin = user?.role === 'admin';

      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Unauthorized to edit this chat' });
      }
      chat.userId = existing.user_id;
    } else {
      // New chat
      chat.userId = req.userId;
      chat.createdAt = chat.createdAt || Date.now();
    }

    saveChatTransaction(chat);
    res.json(chat);
  } catch (err) {
    console.error('Save chat error:', err);
    res.status(500).json({ error: 'Server error saving chat' });
  }
});

app.get('/api/chats/:id', auth, (req, res) => {
  const chat = getChatById(req.params.id);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  const user = getUserById(req.userId);
  const isAdmin = user?.role === 'admin';
  const isOwner = chat.userId === req.userId;

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Unauthorized to view this chat' });
  }

  res.json(chat);
});

app.delete('/api/chats/:id', auth, (req, res) => {
  try {
    const chat = getDb().prepare(`SELECT id, user_id FROM chats WHERE id = ?`).get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const user = getUserById(req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = chat.user_id === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to delete this chat' });
    }

    deleteChatById(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Delete chat error:', err);
    res.status(500).json({ error: 'Server error deleting chat' });
  }
});

// ==================== System Settings (Admin Only) ====================

// Admin-only: read full settings (used by Settings UI)
app.get('/api/system/settings', adminAuth, (req, res) => {
  const deepseekKey = getSystemSetting('deepseekKey');
  res.json({ deepseekKey });
});

// Admin-only: write settings
app.post('/api/system/settings', adminAuth, (req, res) => {
  const { deepseekKey } = req.body;
  if (deepseekKey !== undefined) {
    setSystemSetting('deepseekKey', deepseekKey);
  }
  const updated = getSystemSetting('deepseekKey');
  res.json({ deepseekKey: updated });
});

// Authenticated users: read DeepSeek key (needed to make API calls)
app.get('/api/system/deepseek-key', auth, (req, res) => {
  const deepseekKey = getSystemSetting('deepseekKey');
  res.json({ deepseekKey });
});

// ==================== Serve Frontend ====================

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
