/**
 * Express.js Backend Server
 * 
 * Provides REST API for the RP Chat application.
 * Handles authentication (JWT), CRUD for scenarios/chats/users,
 * system settings, and serves the built frontend from /dist.
 * Uses ESM module system (type: "module" in package.json).
 */

// Load .env first so every module below sees its settings (see README)
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
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
  DataError,
  countAdmins,
  createUserFirstIsAdmin,
  listScenarios,
  getScenarioLabels,
  purgeExpiredScenarioTrash,
  purgeExpiredChatTrash,
} from './database/index.js';

import { ensureUploadsDirs, saveImage, deleteImage, readImage, isValidImagePath, absolutePath as absoluteImagePath } from './database/images.js';
import { fetchImage, ImageFetchError } from './lib/safeImageFetch.js';
import { validateCompletionRequest, relayCompletion, completeOnce, LlmRequestError, DEEPSEEK_BASE_URL, DEFAULT_MODEL, THINKING_LEVELS } from './lib/deepseek.js';
import { readLlmSettings, buildChatPrompt, buildMemoryPrompt, buildScenarioGenerationPrompt, memoryDue, messagesSinceLastMemory } from './lib/prompt.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
/** Body limit for scenario saves/imports, which can embed many base64 images */
const MAX_JSON_BODY_SIZE = process.env.MAX_JSON_BODY_SIZE || '250mb';
/** Body limit for chats, personas (avatar) and AI requests */
const MEDIUM_JSON_BODY_SIZE = process.env.MEDIUM_JSON_BODY_SIZE || '10mb';
/** Body limit for everything else, including unauthenticated routes */
const DEFAULT_JSON_BODY_SIZE = '1mb';

// JWT secret: JWT_SECRET if set, otherwise one generated on first start and
// kept in the database, so restarting the server no longer logs everyone out.
getDb();
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  let secret = getSystemSetting('jwtSecret');
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex');
    setSystemSetting('jwtSecret', secret);
  }
  return secret;
})();

// Behind a reverse proxy, set TRUST_PROXY (e.g. "1" or "loopback") so rate
// limits see each client's address instead of the proxy's
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

// ─── Image Serving Endpoint (BEFORE rate limiter for performance) ─────

/**
 * GET /api/images/*
 * Serves uploaded image files from the filesystem.
 * Path format: /api/images/{entityType}/{prefix}/{id}.{ext}
 * 
 * Images are public by design — access control is enforced at the
 * entity level (scenarios, characters, etc.) through the API.
 * 
 * Caching: an image keeps the same URL when it is replaced (the path comes
 * from the entity id), so it must not be cached as immutable. Browsers
 * revalidate with an ETag (size + modification time) and get a cheap 304
 * when nothing changed, and the new picture as soon as it is replaced.
 *
 * NOTE: Using app.use() with mount path to avoid path-to-regexp v8 issues.
 * The bundled version in Express 5's router (v8.4.2) dropped support for
 * both bare * wildcards and the + modifier syntax. With app.use(), Express
 * strips the mount prefix and the remaining path is in req.path.
 * 
 * This is placed BEFORE the rate limiter to skip 95+ unnecessary JWT
 * verifications + DB lookups on every page load.
 */
app.use('/api/images/', (req, res) => {
  // Only handle GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract the relative path after /api/images/ (strip leading /).
  // isValidImagePath only accepts "{entityType}/{prefix}/{id}.{ext}", so
  // traversal attempts like "../../database.sqlite" never reach the disk.
  const relPath = req.path.replace(/^\//, '');
  if (!isValidImagePath(relPath)) {
    return res.status(400).json({ error: 'Invalid image path' });
  }

  let stat;
  try {
    stat = fs.statSync(absoluteImagePath(relPath));
  } catch {
    return res.status(404).json({ error: 'Image not found' });
  }
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  const image = readImage(relPath);
  if (!image) {
    return res.status(404).json({ error: 'Image not found' });
  }

  res.setHeader('Content-Type', image.contentType);
  res.send(image.buffer);
});

// ─── Security Middleware ───────────────────────────────────────────────

/**
 * Hashes of the inline <script> blocks in the built index.html, so the CSP
 * can allow exactly those scripts instead of 'unsafe-inline'. Computed at
 * startup so editing index.html never silently breaks the page.
 */
function inlineScriptHashes() {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'dist', 'index.html'), 'utf8');
    return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
  } catch {
    return [];
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // No 'unsafe-inline' / 'unsafe-eval': injected markup cannot run script
      scriptSrc: ["'self'", ...inlineScriptHashes()],
      // Inline styles are needed by React style props and animation libraries
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://*.unsplash.com"],

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

/**
 * JSON body parsing.
 * Large bodies are only parsed on the routes that need them, and only after
 * `auth` has run, so unauthenticated clients cannot make the server buffer
 * hundreds of megabytes. Those routes are listed here so the global parser
 * skips them and the route parses with its own limit.
 */
const largeBody = express.json({ limit: MAX_JSON_BODY_SIZE });
const mediumBody = express.json({ limit: MEDIUM_JSON_BODY_SIZE });
const ROUTE_PARSED_BODIES = new Set([
  'POST /api/scenarios',
  'POST /api/chats',
  'POST /api/personas',
]);
const defaultBody = express.json({ limit: DEFAULT_JSON_BODY_SIZE });
app.use((req, res, next) => {
  // Express 5 leaves req.body undefined without a JSON body; routes destructure it
  if (req.body === undefined) req.body = {};
  if (ROUTE_PARSED_BODIES.has(`${req.method} ${req.path}`)) return next();
  defaultBody(req, res, next);
});

/** Turns body-parser errors into JSON responses (used before and after the routes) */
function bodyErrorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.too.large' || err.code === 'ENTITY_TOO_LARGE' || err.status === 413)) {
    console.warn(`[PAYLOAD] ${req.method} ${req.originalUrl} exceeded the body size limit`);
    return res.status(413).json({
      error: 'Request payload too large. Please reduce the number of images or split the import into smaller scenario payloads.'
    });
  }

  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON payload.' });
  }

  next(err);
}
app.use(bodyErrorHandler);

app.use(express.static(path.join(__dirname, 'dist')));

// General rate limiter for all API routes to prevent abuse
// Important: when mounted at '/api', req.path is relative (e.g. '/login' not '/api/login').
// Auth endpoints are skipped since they have their own dedicated authLimiter.
// Admin users are also skipped (bypass rate limiting entirely).
// Non-skipped users get a generous 1000 requests per 15 minute window.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Skip auth endpoints (they have their own authLimiter) AND admin users
  skip: (req) => {
    if (req.path === '/login' || req.path === '/register') return true;
    // Admin users bypass rate limiting entirely
    try {
      const auth = req.headers.authorization;
      if (auth) {
        const token = auth.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = getUserById(decoded.userId);
        if (user?.role === 'admin') return true;
      }
    } catch {
      // Token invalid/expired — don't skip
    }
    return false;
  },
  // Admin-configurable (Admin > Site Branding); synchronous lookup, default 1000
  max: () => Number(getSystemSetting('rateLimitMax')) || 1000,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});



// Apply general rate limiting to all API routes
app.use('/api', generalLimiter);

// Rate limiting for auth endpoints to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 failed attempts per window
  skipSuccessfulRequests: true, // successful logins do not use up the allowance
  message: { error: 'Too many login/registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Initialize database, seed default scenarios, and create upload directories
getDb();
seedDefaultScenariosIfEmpty();
ensureUploadsDirs();

/**
 * Trash auto-purge: items in the trash longer than TRASH_RETENTION_DAYS
 * (default 30, as documented) are permanently deleted, including their
 * image files. Runs at startup and once a day. Set TRASH_RETENTION_DAYS=0
 * to keep trashed items forever.
 */
const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS ?? 30);
function purgeExpiredTrash() {
  if (!(TRASH_RETENTION_DAYS > 0)) return;
  try {
    const removed = purgeExpiredScenarioTrash(TRASH_RETENTION_DAYS) + purgeExpiredChatTrash(TRASH_RETENTION_DAYS);
    if (removed > 0) console.log(`Trash purge: permanently deleted ${removed} item(s) older than ${TRASH_RETENTION_DAYS} days`);
  } catch (err) {
    console.error('Trash purge failed:', err);
  }
}
purgeExpiredTrash();
setInterval(purgeExpiredTrash, 24 * 60 * 60 * 1000).unref();

// ─── Authentication Middleware ────────────────────────────────────────

/**
 * Verifies JWT token from Authorization header.
 * Attaches userId to request on success.
 */
/**
 * Resolves the user for a request's bearer token, or null.
 * Rejects tokens for deleted users and tokens issued before the user's
 * last password change (so changing a password signs out other sessions).
 */
/** Signs a session token. iatMs gives millisecond issue time for revocation checks. */
function signToken(userId) {
  return jwt.sign({ userId, iatMs: Date.now() }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function userFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    const user = getUserById(decoded.userId);
    if (!user) return null;
    // iatMs is set by signToken; older tokens only have iat (seconds)
    const issuedMs = decoded.iatMs ?? decoded.iat * 1000;
    if (user.password_changed_at && issuedMs < user.password_changed_at) return null;
    return user;
  } catch {
    return null;
  }
}

const auth = async (req, res, next) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  req.userId = user.id;
  req.user = user;
  next();
};

/**
 * Verifies JWT AND checks that the user has admin role.
 * Returns 403 if the user is not an admin.
 */
const adminAuth = async (req, res, next) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Forbidden: Admins only' });
  req.userId = user.id;
  req.user = user;
  next();
};

// ─── Auth Routes ──────────────────────────────────────────────────────

const TOKEN_EXPIRY = '7d';

/** Validates password meets minimum length requirement */
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    return 'Password must be at least 6 characters long';
  }
  // bcrypt only uses the first 72 bytes; longer passwords would be silently truncated
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Password must be at most 72 bytes long';
  }
  return null;
}

/** Usernames: 3-32 letters, digits, dot, dash or underscore */
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
function validateUsername(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore';
  }
  return null;
}

const VALID_ROLES = ['user', 'admin'];

/** Hash used to keep login timing the same whether or not the username exists */
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-password', 10);

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

    const usernameError = validateUsername(username);
    if (usernameError) {
      return res.status(400).json({ error: usernameError });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    // Admins can close sign-ups; the very first account (the admin) is always allowed
    if (getSystemSetting('registrationOpen') === 'false') {
      const { cnt } = getDb().prepare(`SELECT COUNT(*) as cnt FROM users WHERE id != 'system'`).get();
      if (cnt > 0) return res.status(403).json({ error: 'Registration is currently closed.' });
    }

    const existing = getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // First real user gets admin role; decided atomically with the insert
    const user = createUserFirstIsAdmin({
      id: uuidv4(),
      username,
      password: hashedPassword,
      createdAt: Date.now(),
    });
    const token = signToken(user.id);
    const { password: _, ...userWithoutPassword } = user;
    console.log(`Registered user: ${username} with role: ${user.role}`);
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'Username already exists' });
    }
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

    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = getUserByUsername(username);
    // Compare against a dummy hash for unknown users so response time does not reveal which usernames exist
    const ok = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = signToken(user.id);
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
app.post('/api/personas', auth, mediumBody, (req, res) => {
  try {
    const persona = { ...req.body, userId: req.userId };
    const saved = upsertPersona(persona);
    res.json(saved);
  } catch (err) {
    if (err instanceof DataError) return res.status(err.status).json({ error: err.message });
    console.error('Save persona error:', err);
    res.status(500).json({ error: 'Server error saving persona' });
  }
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
 * Supports pagination via ?page and ?limit query params.
 */
app.get('/api/scenarios', auth, (req, res) => {
  const isAdmin = req.user?.role === 'admin';

  // Pagination, tab and search are applied in SQL so totals and search
  // results cover every scenario, not just the current page.
  // ?tab=explore|mine-public|mine-private  ?q=search text
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const tab = ['explore', 'mine-public', 'mine-private'].includes(req.query.tab) ? req.query.tab : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';

  const { scenarios, total } = listScenarios({
    userId: req.userId, isAdmin, tab, q, limit, offset: (page - 1) * limit,
  });
  res.json({
    scenarios,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    }
  });
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

  res.json(isOwner || isAdmin ? scenario : scenarioForViewer(scenario));
});

/**
 * What other users may see of a scenario. The AI always gets everything
 * (prompts are built on the server); this only limits what is shown.
 * - If the owner allows customization, nothing is withheld, so copies of
 *   the scenario stay complete.
 * - Otherwise lore pieces marked hidden are withheld, and with "hide
 *   prompts" on, the backstory, custom instructions and all lore too.
 */
function scenarioForViewer(scenario) {
  if (scenario.settings?.allowCustomization) return scenario;
  const visible = { ...scenario, lorePieces: (scenario.lorePieces || []).filter(p => !p.hidden) };
  if (scenario.settings?.hidePrompts) {
    visible.backstory = '';
    visible.customInstructions = '';
    visible.lorePieces = [];
    visible.promptsHidden = true;
  }
  return visible;
}

/**
 * POST /api/scenarios
 * Creates a new scenario or saves edits to an existing one.
 * Handles ownership verification, copy flow, and creator name preservation.
 */
app.post('/api/scenarios', auth, largeBody, (req, res) => {
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
    if (err instanceof DataError) return res.status(err.status).json({ error: err.message });
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

  // Label each chat with its scenario's name and cover, so the chat list
  // does not have to load (a capped page of) every scenario to show them
  const labels = getScenarioLabels(chats.map(c => c.scenarioId));
  for (const c of chats) {
    const label = labels[c.scenarioId];
    c.scenarioName = label?.name || '';
    c.scenarioImage = label?.image || '';
    c.scenarioDeleted = !label || label.deleted;
  }

  res.json(chats);

});

/**
 * POST /api/chats
 * Creates a new chat or saves updates to an existing one.
 * Handles ownership verification.
 */
app.post('/api/chats', auth, mediumBody, (req, res) => {
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
    const chat = getDb().prepare(`SELECT id, user_id, deleted_at FROM chats WHERE id = ?`).get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    // Only items in the trash can be restored or permanently deleted
    if (chat.deleted_at == null) return res.status(400).json({ error: 'Chat is not in the trash' });

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
    const scenario = getDb().prepare(`SELECT id, user_id, deleted_at FROM scenarios WHERE id = ?`).get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    // Only items in the trash can be restored or permanently deleted
    if (scenario.deleted_at == null) return res.status(400).json({ error: 'Scenario is not in the trash' });

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
    const chat = getDb().prepare(`SELECT id, user_id, deleted_at FROM chats WHERE id = ?`).get(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    // Only items in the trash can be restored or permanently deleted
    if (chat.deleted_at == null) return res.status(400).json({ error: 'Chat is not in the trash' });

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
    const scenario = getDb().prepare(`SELECT id, user_id, deleted_at FROM scenarios WHERE id = ?`).get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    // Only items in the trash can be restored or permanently deleted
    if (scenario.deleted_at == null) return res.status(400).json({ error: 'Scenario is not in the trash' });

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
  const storedKey = getSystemSetting('deepseekKey');
  // Only a masked form leaves the server (e.g. "sk-…abcd")
  const deepseekKey = storedKey ? `${storedKey.slice(0, 3)}…${storedKey.slice(-4)}` : '';
  const deepseekKeySet = !!storedKey;
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
  const deepseekModel = getSystemSetting('deepseekModel');
  const debugLlmPrompt = getSystemSetting('debugLlmPrompt');
  const registrationOpen = getSystemSetting('registrationOpen') !== 'false';
  const rateLimitMax = getSystemSetting('rateLimitMax') || '1000';
  const deepseekThinking = getSystemSetting('deepseekThinking') || '';
  const contextTokenBudget = getSystemSetting('contextTokenBudget');
  const loreScanDepth = getSystemSetting('loreScanDepth');
  const loreActiveMax = getSystemSetting('loreActiveMax');
  const lorePinnedMax = getSystemSetting('lorePinnedMax');
  res.json({ deepseekKey, deepseekKeySet, globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong, chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName, memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount, deepseekModel, debugLlmPrompt, registrationOpen, rateLimitMax, deepseekThinking, contextTokenBudget, loreScanDepth, loreActiveMax, lorePinnedMax });



});

/** POST /api/system/settings — Updates system settings (admin only) */
app.post('/api/system/settings', adminAuth, (req, res) => {
  const { deepseekKey, globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong, chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName, memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount, deepseekModel, debugLlmPrompt, registrationOpen, rateLimitMax, deepseekThinking } = req.body;
  // Engine limits: whole numbers within sensible ranges
  for (const [key, min, max] of [['contextTokenBudget', 4000, 1000000], ['loreScanDepth', 1, 200], ['loreActiveMax', 0, 50], ['lorePinnedMax', 0, 100]]) {
    if (req.body[key] === undefined) continue;
    const n = Math.round(Number(req.body[key]));
    if (Number.isFinite(n) && n >= min && n <= max) setSystemSetting(key, String(n));
  }
  // Ignore an echoed masked key so it can never overwrite the real one
  if (typeof deepseekKey === 'string' && deepseekKey.trim() && !deepseekKey.includes('…')) {
    setSystemSetting('deepseekKey', deepseekKey.trim());
  }
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
  if (deepseekModel !== undefined) setSystemSetting('deepseekModel', deepseekModel);
  if (debugLlmPrompt !== undefined) setSystemSetting('debugLlmPrompt', debugLlmPrompt ? 'true' : 'false');
  if (registrationOpen !== undefined) setSystemSetting('registrationOpen', registrationOpen ? 'true' : 'false');
  if (deepseekThinking !== undefined && THINKING_LEVELS.includes(deepseekThinking)) setSystemSetting('deepseekThinking', deepseekThinking);
  if (rateLimitMax !== undefined) {
    const n = Math.round(Number(rateLimitMax));
    if (Number.isFinite(n) && n >= 10 && n <= 100000) setSystemSetting('rateLimitMax', String(n));
  }

  res.json({ success: true });
});

// ─── LLM Debug Logging Helper ────────────────────────────────────────

/**
 * Checks if LLM debug logging is enabled AND the requesting user is an admin.
 * If both conditions are met, logs the full prompt payload to the console.
 * 
 * @param {string} userId - The user ID from the authenticated request
 * @param {object} payload - The request body being sent to DeepSeek
 * @param {string} endpoint - Label describing which endpoint is being called
 */
function debugLogLlmPrompt(userId, payload, endpoint) {
  try {
    const debugEnabled = getSystemSetting('debugLlmPrompt');
    if (debugEnabled !== 'true') return;

    const user = getUserById(userId);
    if (user?.role !== 'admin') return;

    const { messages, model, temperature, max_tokens, frequency_penalty, presence_penalty } = payload;

    console.log('');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log(`│ 🔍 LLM DEBUG — ${endpoint.padEnd(40)}│`);
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log(`│ Model:            ${String(model || DEFAULT_MODEL).padEnd(37)}│`);
    console.log(`│ Temperature:      ${String(temperature ?? 'N/A').padEnd(37)}│`);
    console.log(`│ Max Tokens:       ${String(max_tokens ?? 'N/A').padEnd(37)}│`);
    console.log(`│ Freq Penalty:     ${String(frequency_penalty ?? 'N/A').padEnd(37)}│`);
    console.log(`│ Pres Penalty:     ${String(presence_penalty ?? 'N/A').padEnd(37)}│`);
    console.log(`│ Messages Count:   ${String(messages?.length ?? 0).padEnd(37)}│`);
    console.log('├─────────────────────────────────────────────────────────────┤');
    console.log('│ FULL MESSAGES PAYLOAD:                                      │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    if (messages && Array.isArray(messages)) {
      messages.forEach((msg, i) => {
        const role = msg.role || 'unknown';
        const contentPreview = msg.content?.substring(0, 200) || '';
        console.log(`  [${i}] role: ${role}`);
        console.log(`       content: ${contentPreview}${msg.content?.length > 200 ? '...' : ''}`);
        console.log('');
      });
    }

    console.log('└─────────────────────────────────────────────────────────────┘');
    console.log('');
  } catch (err) {
    // Debug logging should never break the actual request
    console.error('Debug log error:', err);
  }
}

// ─── DeepSeek Proxy Routes ───────────────────────────────────────────


/**
 * GET /api/deepseek/models — Fetches available model IDs from DeepSeek API (admin only)
 * This endpoint proxies DeepSeek's list-models endpoint:
 * https://api-docs.deepseek.com/api/list-models
 */
app.get('/api/deepseek/models', adminAuth, async (req, res) => {
  try {
    const deepseekKey = getSystemSetting('deepseekKey');
    if (!deepseekKey) {
      return res.status(400).json({ error: 'DeepSeek API key is not configured.' });
    }

    const response = await fetch(`${DEEPSEEK_BASE_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${deepseekKey}`,
        'Accept': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(502).json({ error: data.error?.message || `DeepSeek API error (HTTP ${response.status})` });
    }
    res.json(data);
  } catch (err) {
    console.error('DeepSeek models fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch models from DeepSeek API' });
  }
});


/**
 * Per-user limit on AI requests. The DeepSeek key belongs to the site, so one
 * account must not be able to run up the bill. Admins are not limited.
 * LLM_RATE_LIMIT requests per LLM_RATE_WINDOW_MIN minutes (default 120 per 15).
 */
const llmLimiter = rateLimit({
  windowMs: (Number(process.env.LLM_RATE_WINDOW_MIN) || 15) * 60 * 1000,
  max: Number(process.env.LLM_RATE_LIMIT) || 120,
  keyGenerator: (req) => `user:${req.userId}`,
  skip: (req) => getUserById(req.userId)?.role === 'admin',
  message: { error: 'You are sending AI requests too quickly. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Sends a server-built prompt to DeepSeek and relays the answer.
 * The model, thinking mode and token cap come from admin settings
 * (lib/deepseek.js); the browser never supplies prompt text.
 */
async function runCompletion(req, res, { messages, maxTokens, temperature, frequencyPenalty, presencePenalty, label, stream = false }) {
  const deepseekKey = getSystemSetting('deepseekKey');
  if (!deepseekKey) {
    return res.status(400).json({ error: 'DeepSeek API key is not configured. Please ask your administrator to set it in settings.' });
  }
  let params;
  try {
    params = validateCompletionRequest(
      { messages, max_tokens: maxTokens, temperature, frequency_penalty: frequencyPenalty, presence_penalty: presencePenalty },
      {
        model: getSystemSetting('deepseekModel') || DEFAULT_MODEL,
        // Admin "Max Tokens Cap"
        maxTokensCap: Number(getSystemSetting('maxTokens')) || undefined,
        thinking: getSystemSetting('deepseekThinking') || '',
      }
    );
  } catch (err) {
    if (err instanceof LlmRequestError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  // Debug logging for admin users
  debugLogLlmPrompt(req.userId, params, label);
  await relayCompletion(req, res, params, { apiKey: deepseekKey, stream });
}

/**
 * Loads a chat the caller may generate for: it must exist and belong to
 * them (admins can read other users' chats but not write to them).
 * Sends the error response and returns null otherwise.
 */
function loadOwnChatForAi(req, res) {
  const chat = getChatById(req.params.id);
  if (!chat) { res.status(404).json({ error: 'Chat not found' }); return null; }
  if (chat.userId !== req.userId) { res.status(403).json({ error: 'You can only generate replies in your own chats' }); return null; }
  return chat;
}

/**
 * POST /api/chats/:id/reply — AI reply to the chat's last user message.
 * Body: { stream?: boolean }. The prompt is built here from the stored
 * chat and scenario, so the global instructions cannot be bypassed.
 * The client saves the user message first and saves the reply afterwards.
 */
app.post('/api/chats/:id/reply', auth, llmLimiter, async (req, res) => {
  const chat = loadOwnChatForAi(req, res);
  if (!chat) return;
  if (!chat.scenarioId) return res.status(409).json({ error: 'This chat\'s scenario has been deleted' });
  const scenario = getScenarioById(chat.scenarioId);
  if (!scenario) return res.status(409).json({ error: 'This chat\'s scenario has been deleted' });
  const last = chat.messages[chat.messages.length - 1];
  if (!last || last.role !== 'user') {
    return res.status(400).json({ error: 'The last message must be from the user' });
  }

  const llm = readLlmSettings(getSystemSetting);
  const { messages, maxTokens } = buildChatPrompt({ messages: chat.messages, scenario, chat, llm });
  await runCompletion(req, res, {
    messages, maxTokens,
    temperature: llm.temperature, frequencyPenalty: llm.frequencyPenalty, presencePenalty: llm.presencePenalty,
    label: req.body?.stream ? 'Chat Stream' : 'Chat',
    stream: !!req.body?.stream,
  });
});

/**
 * POST /api/chats/:id/memory — Writes a memory card covering everything
 * since the previous memory (rolling memories).
 * Body: { auto?: boolean }. With auto, a memory is only made once enough
 * real user messages arrived (memoryGenerateInterval); otherwise the
 * response is { skipped: true } and no AI call is made.
 * Returns { memory: { id, content, pinned, timestamp, coveredUntil } };
 * the client adds it to the chat and saves.
 */
app.post('/api/chats/:id/memory', auth, async (req, res, next) => {
  const chat = loadOwnChatForAi(req, res);
  if (!chat) return;
  const llm = readLlmSettings(getSystemSetting);
  if (req.body?.auto && !memoryDue(chat, llm)) return res.json({ skipped: true });

  let source = messagesSinceLastMemory(chat);
  // Manual request with nothing new: summarise the most recent part instead
  if (source.length === 0) source = chat.messages.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10);
  if (source.length === 0) return res.status(400).json({ error: 'Nothing to summarise yet' });

  // Only now count it against the AI limit
  llmLimiter(req, res, async () => {
    const deepseekKey = getSystemSetting('deepseekKey');
    if (!deepseekKey) return res.status(400).json({ error: 'DeepSeek API key is not configured.' });
    try {
      const { messages, maxTokens, temperature } = buildMemoryPrompt(source, llm.memoryWordCount);
      const params = validateCompletionRequest({ messages, max_tokens: maxTokens, temperature }, {
        model: getSystemSetting('deepseekModel') || DEFAULT_MODEL,
        maxTokensCap: Number(getSystemSetting('maxTokens')) || undefined,
        thinking: getSystemSetting('deepseekThinking') || '',
      });
      debugLogLlmPrompt(req.userId, params, 'Memory');
      const content = (await completeOnce(params, { apiKey: deepseekKey })).trim();
      if (!content) return res.status(502).json({ error: 'The AI returned an empty memory' });
      res.json({
        memory: {
          id: crypto.randomUUID(),
          content,
          pinned: false,
          timestamp: Date.now(),
          coveredUntil: Math.max(...source.map(m => Number(m.timestamp) || 0)),
        },
      });
    } catch (err) {
      if (err instanceof LlmRequestError) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });
});

/**
 * POST /api/deepseek/generate — Generates a scenario draft from a description.
 * Body: { description: string }. The instructions are built here.
 */
app.post('/api/deepseek/generate', auth, llmLimiter, async (req, res) => {
  const description = req.body?.description;
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'Describe the scenario you want' });
  }
  if (description.length > 10000) {
    return res.status(413).json({ error: 'Description is too long (max 10,000 characters)' });
  }
  const { messages, maxTokens, temperature } = buildScenarioGenerationPrompt(description);
  await runCompletion(req, res, { messages, maxTokens, temperature, label: 'Generate' });
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
  const deepseekModel = getSystemSetting('deepseekModel');
  res.json({ globalInstructions, temperature, maxTokens, tokenShort, tokenMedium, tokenLong, chatPaddingLeft, chatPaddingRight, frequencyPenalty, presencePenalty, siteName, memorySendInterval, memoryGenerateInterval, memoryWordCount, memoryMaxCount, deepseekModel });



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
    // Other sessions are now signed out; give this one a fresh token
    const token = signToken(req.userId);
    res.json({ success: true, token });
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
    const inputError = validateUsername(username) || validatePassword(password)
      || (role !== undefined && !VALID_ROLES.includes(role) ? 'Role must be "user" or "admin"' : null);
    if (inputError) return res.status(400).json({ error: inputError });
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
    if (username !== undefined && username !== targetUser.username) {
      const usernameError = validateUsername(username);
      if (usernameError) return res.status(400).json({ error: usernameError });
      const taken = getUserByUsername(username);
      if (taken && taken.id !== targetUser.id) return res.status(400).json({ error: 'Username already exists' });
      updates.username = username;
    }
    if (role !== undefined && role !== targetUser.role) {
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Role must be "user" or "admin"' });
      // Never remove the last admin, or nobody could manage the site
      if (targetUser.role === 'admin' && countAdmins() <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
      updates.role = role;
    }
    if (password !== undefined && password !== '') {
      const passwordError = validatePassword(password);
      if (passwordError) return res.status(400).json({ error: passwordError });
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

// ─── Image Proxy ──────────────────────────────────────────────────────

/**
 * GET /api/proxy-image
 * Fetches a remote image server-side and returns it as a base64 data URL.
 * Used by the FictionLab import flow to bypass CORS restrictions when
 * fetching images from CDNs that don't set Access-Control-Allow-Origin.
 *
 * Query params:
 *   url - The full URL of the image to fetch (required)
 *
 * Returns: { dataUrl: "data:image/webp;base64,..." }
 *
 * Requires login. Only public http(s) addresses are fetched (see
 * lib/safeImageFetch.js), with a timeout, a 10 MB cap and image-only types.
 */
app.get('/api/proxy-image', auth, async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string' || url.length > 2048) {
      return res.status(400).json({ error: 'Missing or invalid "url" query parameter' });
    }

    const { contentType, buffer } = await fetchImage(url);
    res.json({ dataUrl: `data:${contentType};base64,${buffer.toString('base64')}` });
  } catch (err) {
    if (err instanceof ImageFetchError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Proxy-image error:', err);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

// ─── Serve Frontend ───────────────────────────────────────────────────

// Unknown API routes get a JSON 404 instead of the HTML app shell
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Catch-all: serve index.html for all non-API routes (SPA support)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Final error handlers: body-parser errors from route-level parsers, then
// anything unexpected. Never send stack traces to the client.
app.use(bodyErrorHandler);
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return res.end();
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: 'Internal server error' });
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
