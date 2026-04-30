/**
 * Express.js Backend Server
 * 
 * Provides REST API for the RP Chat application.
 * Handles authentication (JWT), CRUD for scenarios/chats/users,
 * system settings, and serves the built frontend from /dist.
 * Uses ESM module system (type: "module" in package.json).
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  getDb,
  createUser,
  getUserByUsername,
  getUserById,
  getUserWithPersonas,
  getAllUsers,
  updateUser,
  deleteUserById,
  getPersonasByUserId,
  upsertPersona,
  deletePersonaById,
  getAllScenarios,
  getAccessibleScenarios,

  getScenarioById,
  saveScenarioTransaction,
  deleteScenarioById,
  getTrashedScenariosByUserId,
  restoreScenarioById,
  permanentlyDeleteScenarioById,
  emptyScenarioTrashByUserId,
  getChatsByUserId,
  getChatById,
  saveChatTransaction,
  deleteChatById,
  getTrashedChatsByUserId,
  restoreChatById,
  permanentlyDeleteChatById,
  emptyChatTrashByUserId,
  deleteAllChatsByUserId,

  getSystemSetting,
  setSystemSetting,
  getUserSetting,
  setUserSetting,
  getAllUserSettings,
  seedDefaultScenariosIfEmpty,
} from './database/index.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Generate a random JWT secret if one isn't provided via environment variable
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

// ─── Security Middleware ───────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "block:", "https://images.unsplash.com", "https://*.unsplash.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://api.deepseek.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — restrict in production
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// General rate limiter for all API routes to prevent abuse
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window per IP
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply general rate limiting to all API routes
app.use('/api', generalLimiter);

// Rate limiting for auth endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: { error: 'Too many login/registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Initialize database and seed default scenarios on startup
getDb();
seedDefaultScenariosIfEmpty();

// ─── Authentication Middleware ────────────────────────────────────────

/**
 * Verifies JWT token from Authorization header.
 * Attaches userId to request on success.
 */
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

/**
 * Verifies JWT AND checks that the user has admin role.
 * Returns 403 if the user is not an admin.
 */
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

// ─── Auth Routes ──────────────────────────────────────────────────────

const TOKEN_EXPIRY = '7d';

/** Validates password meets minimum length requirement */
function validatePassword(password) {
  if (!password || password.length < 6) {
    return 'Password must be at least 6 characters long';
  }
  return null;
}

/**
 * POST /api/register
 * Creates a new user account. First real user (non-system) gets admin role.
 * Rate limited to 20 attempts per 15 minutes.
 */
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // First real user gets admin role (exclude internal system user)
    const realUsers = getDb().prepare(`SELECT COUNT(*) as cnt FROM users WHERE id != 'system'`).get();
    const role = realUsers.cnt === 0 ? 'admin' : 'user';

    const user = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      role,
      createdAt: Date.now(),
    };

    createUser(user);
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    const { password: _, ...userWithoutPassword } = user;
    console.log(`Registered user: ${username} with role: ${role}`);
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

/**
 * POST /api/login
 * Authenticates a user and returns a JWT token.
 * Rate limited to 20 attempts per 15 minutes.
 */
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = getUserByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    const { password: _, ...userWithoutPassword } = user;
    console.log(`Logged in user: ${username}`);
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// ─── User Routes ──────────────────────────────────────────────────────

/** GET /api/users/me — Returns current user profile with personas */
app.get('/api/users/me', auth, (req, res) => {
  const user = getUserWithPersonas(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ─── Persona Routes ──────────────────────────────────────────────────

/** GET /api/personas — Returns all personas for the authenticated user */
app.get('/api/personas', auth, (req, res) => {
  const personas = getPersonasByUserId(req.userId);
  res.json(personas);
});

/** POST /api/personas — Creates or updates a persona */
app.post('/api/personas', auth, (req, res) => {
  const persona = { ...req.body, userId: req.userId };
  const saved = upsertPersona(persona);
  res.json(saved);
});

/** DELETE /api/personas/:id — Deletes a persona (owner-only) */
app.delete('/api/personas/:id', auth, (req, res) => {
  const deleted = deletePersonaById(req.params.id, req.userId);
  if (!deleted) return res.status(404).json({ error: 'Persona not found or unauthorized' });
  res.status(204).send();
});

// ─── Scenario Routes ──────────────────────────────────────────────────

/**
 * GET /api/scenarios
 * Returns all accessible scenarios for the user.
 * Admins see all scenarios; regular users see public + own.
 */
app.get('/api/scenarios', auth, (req, res) => {
  const user = getUserById(req.userId);
  const isAdmin = user?.role === 'admin';

  let scenarios;
  if (isAdmin) {
    scenarios = getAllScenarios();
  } else {
    scenarios = getAccessibleScenarios(req.userId);
  }

  res.json(scenarios);
});

/**
 * GET /api/scenarios/:id
 * Returns a single scenario with characters and lore.
 * Enforces access control: only owner and admin can view private scenarios.
 */
app.get('/api/scenarios/:id', auth, (req, res) => {
  const scenario = getScenarioById(req.params.id);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const user = getUserById(req.userId);
  const isAdmin = user?.role === 'admin';
  const isOwner = scenario.userId === req.userId;

  // Private scenario — only owner and admin can view
  if (!scenario.settings?.isPublic && !isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Unauthorized to view this scenario' });
  }

  res.json(scenario);
});

/**
 * POST /api/scenarios
 * Creates a new scenario or saves edits to an existing one.
 * Handles ownership verification, copy flow, and creator name preservation.
 */
app.post('/api/scenarios', auth, (req, res) => {
  try {
    const scenario = req.body;
    const existing = getDb().prepare(`SELECT id, user_id FROM scenarios WHERE id = ?`).get(scenario.id);

    if (existing) {
      // Editing existing scenario — only owner or admin can edit in-place
      const isOwner = existing.user_id === req.userId;
      const user = getUserById(req.userId);
      const isAdmin = user?.role === 'admin';

      if (!isOwner && !isAdmin) {
        return res.status(403).json({ error: 'Unauthorized to edit this scenario' });
      }

      // Preserve original creator
      scenario.userId = existing.user_id;
      const original = getScenarioById(scenario.id);
      scenario.creatorName = original?.creatorName || '';
    } else {
      // New scenario (also used for copy flow — frontend generates a fresh UUID)
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

/**
 * DELETE /api/scenarios/:id
 * Deletes (soft-delete, moves to trash) a scenario. Owner or admin only.
 */
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

// ─── Chat Routes ──────────────────────────────────────────────────────

/**
 * GET /api/chats
 * Returns the user's chats. Admins see all users' chats with owner info.
 */
app.get('/api/chats', auth, (req, res) => {
  const user = getUserById(req.userId);
  const isAdmin = user?.role === 'admin';

  let chats;
  if (isAdmin) {
    // Admin sees all chats for management
    const rawChats = getDb().prepare(`SELECT * FROM chats WHERE deleted_at IS NULL ORDER BY created_at DESC`).all();
    chats = rawChats.map(chat => {
      const c = getChatById(chat.id);
      if (!c) return null;
      // Attach the owner's username
      const owner = getUserById(chat.user_id);
      c.ownerUsername = owner?.username || 'Unknown';
      return c;
    });
    chats = chats.filter(Boolean);
  } else {
    // Regular user sees only their own chats
    chats = getChatsByUserId(req.userId);
  }

  res.json(chats);

});

/**
 * POST /api/chats
 * Creates a new chat or saves updates to an existing one.
 * Handles ownership verification.
 */
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

/** GET /api/chats/:id — Returns a single chat with messages and memories */
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

/** DELETE /api/chats/all — Deletes all chats for the authenticated user */
app.delete('/api/chats/all', auth, (req, res) => {
  try {
    deleteAllChatsByUserId(req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete all chats error:', err);
    res.status(500).json({ error: 'Server error deleting chats' });
  }
});

/** DELETE /api/chats/:id — Deletes (soft-delete, moves to trash) a single chat (owner or admin) */
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

// ─── Trash / Recycle Bin Routes ────────────────────────────────────────

/**
 * GET /api/trash
 * Returns all trashed items (chats and scenarios) for the authenticated user.
 */
app.get('/api/trash', auth, (req, res) => {
  const trashedChats = getTrashedChatsByUserId(req.userId);
  const trashedScenarios = getTrashedScenariosByUserId(req.userId);
  res.json({ chats: trashedChats, scenarios: trashedScenarios });
});

/**
 * POST /api/trash/restore/chat/:id
 * Restores a soft-deleted chat from the trash.
 */
app.post('/api/trash/restore/chat/:id', auth, (req, res) => {
  try {
    const chat = getDb().prepare(`SELECT id, user_id FROM chats WHERE id = ?`).get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const user = getUserById(req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = chat.user_id === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to restore this chat' });
    }

    restoreChatById(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Restore chat error:', err);
    res.status(500).json({ error: 'Server error restoring chat' });
  }
});

/**
 * POST /api/trash/restore/scenario/:id
 * Restores a soft-deleted scenario from the trash.
 */
app.post('/api/trash/restore/scenario/:id', auth, (req, res) => {
  try {
    const scenario = getDb().prepare(`SELECT id, user_id FROM scenarios WHERE id = ?`).get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const user = getUserById(req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = scenario.user_id === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to restore this scenario' });
    }

    restoreScenarioById(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Restore scenario error:', err);
    res.status(500).json({ error: 'Server error restoring scenario' });
  }
});

/**
 * DELETE /api/trash/chat/:id
 * Permanently deletes a chat from the trash (final deletion).
 */
app.delete('/api/trash/chat/:id', auth, (req, res) => {
  try {
    const chat = getDb().prepare(`SELECT id, user_id FROM chats WHERE id = ?`).get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const user = getUserById(req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = chat.user_id === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to permanently delete this chat' });
    }

    permanentlyDeleteChatById(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Permanent delete chat error:', err);
    res.status(500).json({ error: 'Server error permanently deleting chat' });
  }
});

/**
 * DELETE /api/trash/scenario/:id
 * Permanently deletes a scenario from the trash (final deletion).
 */
app.delete('/api/trash/scenario/:id', auth, (req, res) => {
  try {
    const scenario = getDb().prepare(`SELECT id, user_id FROM scenarios WHERE id = ?`).get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

    const user = getUserById(req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = scenario.user_id === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to permanently delete this scenario' });
    }

    permanentlyDeleteScenarioById(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Permanent delete scenario error:', err);
    res.status(500).json({ error: 'Server error permanently deleting scenario' });
  }
});

/**
 * DELETE /api/trash/empty
 * Permanently deletes all trashed items (chats and scenarios) for the authenticated user.
 */
app.delete('/api/trash/empty', auth, (req, res) => {
  try {
    emptyChatTrashByUserId(req.userId);
    emptyScenarioTrashByUserId(req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Empty trash error:', err);
    res.status(500).json({ error: 'Server error emptying trash' });
  }
});

// ─── System Settings (Admin Only) ─────────────────────────────────────

/** GET /api/system/settings — Returns all system settings (admin only) */
app.get('/api/system/settings', adminAuth, (req, res) => {
  const deepseekKey = getSystemSetting('deepseekKey');
  const globalInstructions = getSystemSetting('globalInstructions');
  const temperature = getSystemSetting('temperature');
  const maxTokens = getSystemSetting('maxTokens');
  const tokenShort = getSystemSetting('tokenShort');
  const tokenMedium = getSystemSetting('tokenMedium');
  const tokenLong = getSystemSetting('tokenLong');
  const chatPaddingLeft = getSystemSetting('chatPaddingLeft');
  const chatPaddingRight = getSystemSetting('chatPaddingRight');
  const frequencyPenalty = getSystemSetting('frequencyPenalty');
  const presencePenalty = getSystemSetting('presencePenalty');
  const siteName = getSystemSetting('siteName');
  const memorySendInterval = getSystemSetting('memorySendInterval');
  const memoryGenerateInterval = getSystemSetting('memoryGenerateInterval');
  const memoryWordCount = getSystemSetting('memoryWordCount');
  const memoryMaxCount = getSystemSetting('memoryMaxCount');
  res.json({ deepseekKey, globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong, chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName, memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount });


});

/** POST /api/system/settings — Updates system settings (admin only) */
app.post('/api/system/settings', adminAuth, (req, res) => {
  const { deepseekKey, globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong, chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName, memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount } = req.body;
  if (deepseekKey !== undefined) setSystemSetting('deepseekKey', deepseekKey);
  if (globalInstructions !== undefined) setSystemSetting('globalInstructions', globalInstructions);
  if (temperature !== undefined) setSystemSetting('temperature', String(temperature));
  if (maxTokens !== undefined) setSystemSetting('maxTokens', String(maxTokens));
  if (tokenShort !== undefined) setSystemSetting('tokenShort', String(tokenShort));
  if (tokenMedium !== undefined) setSystemSetting('tokenMedium', String(tokenMedium));
  if (tokenLong !== undefined) setSystemSetting('tokenLong', String(tokenLong));
  if (chatPaddingLeft !== undefined) setSystemSetting('chatPaddingLeft', String(chatPaddingLeft));
  if (chatPaddingRight !== undefined) setSystemSetting('chatPaddingRight', String(chatPaddingRight));
  if (frequencyPenalty !== undefined) setSystemSetting('frequencyPenalty', String(frequencyPenalty));
  if (presencePenalty !== undefined) setSystemSetting('presencePenalty', String(presencePenalty));
  if (siteName !== undefined) setSystemSetting('siteName', siteName);
  if (memorySendInterval !== undefined) setSystemSetting('memorySendInterval', String(memorySendInterval));
  if (memoryGenerateInterval !== undefined) setSystemSetting('memoryGenerateInterval', String(memoryGenerateInterval));
  if (memoryWordCount !== undefined) setSystemSetting('memoryWordCount', String(memoryWordCount));
  if (memoryMaxCount !== undefined) setSystemSetting('memoryMaxCount', String(memoryMaxCount));
  res.json({ success: true });


});

/** GET /api/system/deepseek-key — Returns the DeepSeek API key (admin only) */
app.get('/api/system/deepseek-key', adminAuth, (req, res) => {
  const deepseekKey = getSystemSetting('deepseekKey');
  res.json({ deepseekKey });
});

// ─── DeepSeek Proxy Routes ───────────────────────────────────────────

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * POST /api/deepseek/chat — Proxies non-streaming chat to DeepSeek API
 * The API key stays server-side — never exposed to the client.
 */
app.post('/api/deepseek/chat', auth, async (req, res) => {
  try {
    const deepseekKey = getSystemSetting('deepseekKey');
    if (!deepseekKey) {
      return res.status(400).json({ error: 'DeepSeek API key is not configured. Please ask your administrator to set it in settings.' });
    }
    const { messages, model, temperature, max_tokens, frequency_penalty, presence_penalty } = req.body;

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages,
        temperature,
        max_tokens,
        frequency_penalty,
        presence_penalty,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'DeepSeek API error' });
    }
    res.json(data);
  } catch (err) {
    console.error('DeepSeek proxy error:', err);
    res.status(500).json({ error: 'Failed to communicate with DeepSeek API' });
  }
});

/**
 * POST /api/deepseek/chat/stream — Proxies SSE streaming chat to DeepSeek API
 * Streams data chunks back to the client as they arrive from DeepSeek.
 */
app.post('/api/deepseek/chat/stream', auth, async (req, res) => {
  try {
    const deepseekKey = getSystemSetting('deepseekKey');
    if (!deepseekKey) {
      return res.status(400).json({ error: 'DeepSeek API key is not configured.' });
    }
    const { messages, model, temperature, max_tokens, frequency_penalty, presence_penalty } = req.body;

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model: model || 'deepseek-chat',
        messages,
        temperature,
        max_tokens,
        frequency_penalty,
        presence_penalty,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: errorData.error?.message || 'DeepSeek API error' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Pipe the DeepSeek stream to the client
    const reader = response.body?.getReader();
    if (!reader) {
      return res.status(500).json({ error: 'No response body' });
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.write('data: [DONE]\n\n');
        res.end();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          res.write(line + '\n');
        }
      }
    }
  } catch (err) {
    console.error('DeepSeek streaming proxy error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to communicate with DeepSeek API' });
    }
  }
});

/**
 * POST /api/deepseek/generate — Proxies scenario generation to DeepSeek API
 */
app.post('/api/deepseek/generate', auth, async (req, res) => {
  try {
    const deepseekKey = getSystemSetting('deepseekKey');
    if (!deepseekKey) {
      return res.status(400).json({ error: 'DeepSeek API key is not configured.' });
    }
    const { messages, temperature, max_tokens } = req.body;

    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: temperature || 0.8,
        max_tokens: max_tokens || 4000,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'DeepSeek API error' });
    }
    res.json(data);
  } catch (err) {
    console.error('DeepSeek generate proxy error:', err);
    res.status(500).json({ error: 'Failed to communicate with DeepSeek API' });
  }
});

/** GET /api/system/llm-settings — Returns LLM configuration (any authenticated user) */
app.get('/api/system/llm-settings', auth, (req, res) => {
  const globalInstructions = getSystemSetting('globalInstructions');
  const temperature = getSystemSetting('temperature');
  const maxTokens = getSystemSetting('maxTokens');
  const tokenShort = getSystemSetting('tokenShort');
  const tokenMedium = getSystemSetting('tokenMedium');
  const tokenLong = getSystemSetting('tokenLong');
  const chatPaddingLeft = getSystemSetting('chatPaddingLeft');
  const chatPaddingRight = getSystemSetting('chatPaddingRight');
  const frequencyPenalty = getSystemSetting('frequencyPenalty');
  const presencePenalty = getSystemSetting('presencePenalty');
  const siteName = getSystemSetting('siteName');
  const memorySendInterval = getSystemSetting('memorySendInterval');
  const memoryGenerateInterval = getSystemSetting('memoryGenerateInterval');
  const memoryWordCount = getSystemSetting('memoryWordCount');
  const memoryMaxCount = getSystemSetting('memoryMaxCount');
  res.json({ globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong, chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName, memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount });


});

// ─── Change Password ──────────────────────────────────────────────────

/**
 * POST /api/users/change-password
 * Allows authenticated users to change their password.
 * Requires current password verification before updating.
 */
app.post('/api/users/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const user = getUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    updateUser(req.userId, { password: hashedPassword });
    res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error changing password' });
  }
});

// ─── User Settings ────────────────────────────────────────────────────

/** GET /api/users/settings — Returns all settings for the authenticated user */
app.get('/api/users/settings', auth, (req, res) => {
  const settings = getAllUserSettings(req.userId);
  res.json(settings);
});

/** List of allowed user settings keys to prevent arbitrary data injection */
const ALLOWED_USER_SETTINGS_KEYS = new Set([
  'dialogColor',
  'narrationColor',
  'chatBubbleColor',
]);

/** POST /api/users/settings — Saves user settings (single key-value or bulk object) */
app.post('/api/users/settings', auth, (req, res) => {
  const { key, value } = req.body;
  if (key && value !== undefined) {
    if (!ALLOWED_USER_SETTINGS_KEYS.has(key)) {
      return res.status(400).json({ error: `Invalid setting key: ${key}` });
    }
    setUserSetting(req.userId, key, value);
    res.json({ success: true });
  } else if (typeof req.body === 'object') {
    // Bulk save: { key1: value1, key2: value2 }
    for (const [k, v] of Object.entries(req.body)) {
      if (!ALLOWED_USER_SETTINGS_KEYS.has(k)) {
        return res.status(400).json({ error: `Invalid setting key: ${k}` });
      }
      setUserSetting(req.userId, k, String(v));
    }
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid settings data' });
  }
});

// ─── Admin: User Management ───────────────────────────────────────────

/** GET /api/admin/users — Returns all users with chat counts (admin only) */
app.get('/api/admin/users', adminAuth, (req, res) => {
  const users = getAllUsers();
  res.json(users);
});

/** POST /api/admin/users — Creates a new user (admin only) */
app.post('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(),
      username,
      password: hashedPassword,
      role: role || 'user',
      createdAt: Date.now(),
    };
    createUser(user);
    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Server error creating user' });
  }
});

/** PUT /api/admin/users/:id — Updates a user (admin only). Cannot modify system user. */
app.put('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const { username, role, password } = req.body;
    const targetUser = getUserById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.id === 'system') return res.status(400).json({ error: 'Cannot modify system user' });

    const updates = {};
    if (username !== undefined) updates.username = username;
    if (role !== undefined) updates.role = role;
    if (password !== undefined && password.trim()) {
      updates.password = await bcrypt.hash(password, 10);
    }

    const updated = updateUser(req.params.id, updates);
    const { password: _, ...userWithoutPassword } = updated;
    res.json(userWithoutPassword);
  } catch (err) {
    console.error('Admin update user error:', err);
    res.status(500).json({ error: 'Server error updating user' });
  }
});

/** DELETE /api/admin/users/:id — Deletes a user (admin only). Cannot delete self or system. */
app.delete('/api/admin/users/:id', adminAuth, (req, res) => {
  try {
    const targetUser = getUserById(req.params.id);
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.id === 'system') return res.status(400).json({ error: 'Cannot delete system user' });
    if (targetUser.id === req.userId) return res.status(400).json({ error: 'Cannot delete yourself' });

    deleteUserById(req.params.id);
    res.status(204).send();
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ error: 'Server error deleting user' });
  }
});

// ─── Serve Frontend ───────────────────────────────────────────────────

// Catch-all: serve index.html for all non-API routes (SPA support)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
