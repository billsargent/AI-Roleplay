
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const JWT_SECRET = 'fictionlab-super-secret-key';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// DB structure: { users: [], scenarios: [], chats: [], settings: { deepseekKey: '' } }
const initDb = async () => {
  try {
    await fs.access(DB_FILE);
    console.log('Database found.');
  } catch {
    console.log('Database not found. Creating new one...');
    await fs.writeFile(DB_FILE, JSON.stringify({ 
      users: [], 
      scenarios: [], 
      chats: [], 
      settings: { deepseekKey: '' } 
    }, null, 2));
  }
};

const readDb = async () => {
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return { users: [], scenarios: [], chats: [], settings: { deepseekKey: '' } };
  }
};

const writeDb = async (db) => {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
};

// Middleware for auth
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

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = await readDb();
    if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    // First user is admin
    const role = db.users.length === 0 ? 'admin' : 'user';
    
    const user = { 
      id: 'u-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9), 
      username, 
      password: hashedPassword, 
      role, 
      personas: [] 
    };
    
    db.users.push(user);
    await writeDb(db);
    
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

    const db = await readDb();
    const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    
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

// Admin Settings
app.get('/api/system/settings', auth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find(u => u.id === req.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden: Admins only' });
  res.json(db.settings);
});

app.post('/api/system/settings', auth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find(u => u.id === req.userId);
  if (user?.role !== 'admin') return res.status(403).json({ error: 'Forbidden: Admins only' });
  
  db.settings = { ...db.settings, ...req.body };
  await writeDb(db);
  res.json(db.settings);
});

// Personas
app.post('/api/personas', auth, async (req, res) => {
  const persona = req.body;
  const db = await readDb();
  const userIndex = db.users.findIndex(u => u.id === req.userId);
  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
  
  const personaIndex = db.users[userIndex].personas.findIndex(p => p.id === persona.id);
  if (personaIndex >= 0) {
    db.users[userIndex].personas[personaIndex] = persona;
  } else {
    db.users[userIndex].personas.push(persona);
  }
  
  await writeDb(db);
  res.json(persona);
});

app.delete('/api/personas/:id', auth, async (req, res) => {
  const db = await readDb();
  const userIndex = db.users.findIndex(u => u.id === req.userId);
  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
  
  db.users[userIndex].personas = db.users[userIndex].personas.filter(p => p.id !== req.params.id);
  await writeDb(db);
  res.status(204).send();
});

// Scenarios
app.get('/api/scenarios', async (req, res) => {
  const db = await readDb();
  res.json(db.scenarios);
});

app.post('/api/scenarios', auth, async (req, res) => {
  try {
    const scenario = req.body;
    const db = await readDb();
    const index = db.scenarios.findIndex(s => s.id === scenario.id);
    
    if (index === -1) {
      const user = db.users.find(u => u.id === req.userId);
      scenario.userId = req.userId;
      scenario.creatorName = user?.username;
      db.scenarios.push(scenario);
    } else {
      const existing = db.scenarios[index];
      const isOwner = existing.userId === req.userId;
      const allowsCustomization = existing.settings?.allowCustomization;

      if (!isOwner && !allowsCustomization) {
        return res.status(403).json({ error: 'Unauthorized to edit this scenario' });
      }
      
      // If it's a customization of someone else's work, the frontend should ideally 
      // change the ID to create a fork, but if they are editing the same ID 
      // (and it allows customization), we let them save.
      db.scenarios[index] = { ...scenario, userId: existing.userId, creatorName: existing.creatorName };
    }
    
    await writeDb(db);
    res.json(scenario);
  } catch (err) {
    res.status(500).json({ error: 'Server error saving scenario' });
  }
});

app.delete('/api/scenarios/:id', auth, async (req, res) => {
  try {
    const db = await readDb();
    const index = db.scenarios.findIndex(s => s.id === req.params.id);
    
    if (index === -1) return res.status(404).json({ error: 'Scenario not found' });
    
    const scenario = db.scenarios[index];
    const user = db.users.find(u => u.id === req.userId);
    const isAdmin = user?.role === 'admin';
    const isOwner = scenario.userId === req.userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Unauthorized to delete this scenario' });
    }
    
    db.scenarios.splice(index, 1);
    await writeDb(db);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: 'Server error deleting scenario' });
  }
});

// Serve Frontend
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
});
