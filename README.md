# AI Roleplay

An immersive, AI-powered roleplay platform where you create stories, build worlds, and chat with intelligent AI characters. Built with a modern React frontend and an Express + SQLite backend, powered by the DeepSeek language model.

**Current version: 2.1.0.** See [CHANGELOG.md](CHANGELOG.md) for what changed, and its *Upgrading from 1.x* section before updating an existing install.

---

## ✨ Features

### 📖 Scenario System
- **Create & Edit Rich Scenarios** — Full-featured editor with backstory, cast of characters, lore pieces, and custom instructions
- **AI-Powered Generation** — Describe a scenario in natural language and the AI builds a complete world with characters and lore
- **Lore Suggestions** — The AI proposes lore cards from your story; pick and adjust the ones to add
- **AI Enhance** — Fix spelling, grammar and clarity in any editor field; you see the changes before accepting
- **Public / Private Scenarios** — Share your creations with the community or keep them private
- **Copy & Customize** — Fork any public scenario and make it your own
- **Tag-Based Discovery** — Search and browse community scenarios by name, tags, or creator
- **Scenario Detail View** — Inspect full backstory, character profiles, and lore before playing
- **Scenario Import** — Import Fictionlab exports (every known export shape), keeping lore types, descriptions, traits, pictures and links

### 🤖 AI Chat & Roleplay
- **Real-Time Streaming** — AI responses stream character-by-character via Server-Sent Events (SSE) for instant feedback
- **Context-Aware Responses** — The server builds each prompt from the world setting, characters, lore, memories and as much recent conversation as fits a token budget, so long chats keep working
- **Smart Lore Activation** — Triggered lore is included when a trigger word appears as a whole word in the last few messages (5 at a time by default, highest priority first)
- **Rolling Memories** — Every few user messages the AI writes a memory card summarising everything since the previous one; all memories are sent with every reply and pinned ones are never trimmed
- **Memory Panel** — See where each memory was made, edit, pin (up to 10 "key facts") or write your own, and see what the AI was given for each reply
- **Response Length Control** — Choose short, medium, or long AI responses
- **Stop & Retry** — Stop a reply while it is being written (the text so far is kept), and retry a reply that failed
- **Regenerate & Continue** — Regenerate the last reply and flip between versions; Continue extends a reply, picking up exactly where it stopped
- **Message Editing** — Edit, delete, or rewind messages
- **Reading Layout** — Centred reading column that fits any screen; the view follows new text while you are at the bottom and leaves you in place when you scroll up
- **Scene Bar** — Shows the place, day and time from the scene line the AI writes, with a divider when the place changes

### 🧩 Characters & Personas
- **Multi-Character Casts** — Scenarios can have any number of NPCs with names, descriptions, and personality profiles
- **User Personas** — Create multiple character profiles (personas) to use across different scenarios
- **Character Avatars** — Upload images for both NPCs and user personas (camera or file picker); images are stored as files under `uploads/`

### 🧠 Lore System
- **Lore Pieces** — Define locations, events, objects, and other world-building elements
- **Sent to the AI** — Each piece is sent *Always* (up to 10 by default), *When a trigger word comes up*, or *Never* (draft)
- **Priority** — Higher-priority pieces win when more pieces qualify than the caps allow
- **Hidden from Players** — The AI uses the piece but other players cannot read it (also enforced by the scenario's *Hide Prompts* switch)
- **Linked Pieces** — Pieces linked to another are sent right after it (a draft piece can exist just to be linked)
- **Lore Overview** — Every reply lists the other lore by title and a one-line summary; pieces named in the scenario instructions are always sent
- **Check & Fix Lore** — Finds lore that never reaches the AI, repairs imported quirks, and asks the AI for trigger words; admin bulk "Lore Health"

### 👤 User System
- **JWT Authentication** — Secure token-based auth with 7-day session expiry; sessions survive server restarts
- **Registration & Login** — First user auto-gains admin role; admins can close new sign-ups
- **Password Management** — Change your password with current verification; this signs out your other sessions
- **Trash / Recycle Bin** — Deleted chats and scenarios go to trash instead of being permanently removed. Restore them or permanently delete from the Trash page in Settings. Items are permanently deleted after 30 days (`TRASH_RETENTION_DAYS`, `0` keeps them forever).
- **Chat Appearance Customization** — Set your own dialog highlight color, narration text color, and chat bubble background color

### 🛠️ Admin Panel
- **DeepSeek API Key Configuration** — Set or replace the AI provider key; the stored key is never sent back to the browser (only a masked form)
- **Model & Thinking Mode** — Pick the DeepSeek model for chats, a cheaper background model for memories and generation, and whether it reasons before replying
- **Stop Sequences** — Stop a reply when the AI starts writing as the player, plus custom stops
- **LLM Parameters** — Configure temperature, max tokens, frequency/presence penalties
- **Response Token Limits** — Set short/medium/long response token caps
- **Memory Management** — Configure how often memories are written, their length, and how many are kept
- **Context & Lore** — Context token budget, how many recent messages trigger lore, and the lore caps
- **Site Branding** — Custom site name displayed throughout the app
- **Rate Limit & Sign-ups** — Set the general API rate limit and turn new registrations on or off
- **User Management** — View, create, edit, and delete users with role assignment (the last admin cannot be demoted)

### 🔒 Security
- **Server-Side API Key** — DeepSeek API key is stored server-side and never sent to the browser
- **Server-Built Prompts** — The browser only says which chat to answer; the server assembles the prompt, picks the model, caps reply length and clamps sampling settings, so the key cannot be used for arbitrary prompts. Each user has their own AI request limit
- **Helmet CSP** — Content Security Policy without inline or eval script; scenario introductions are sanitized on save and on display
- **Rate Limiting** — General API (1000/15min, admin-configurable), failed logins (20/15min), AI requests (120/15min per user)
- **Upload Safety** — Image paths are validated, image types are checked from the file bytes (no SVG), large request bodies are only accepted after login
- **SQL Injection Protection** — All queries use parameterized statements (better-sqlite3)
- **Input Validation** — Username and password rules, user settings key allowlist
- **UUIDv4 Generation** — Cryptographically random user IDs
- **CORS Configuration** — Restrictable to specific origins in production
- **bcrypt Password Hashing** — 10 salt rounds for all stored passwords

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.9, Vite 7 |
| **Styling** | Tailwind CSS v4, Framer Motion, Lucide React icons |
| **Routing** | React Router v7 |
| **Backend** | Express 5 (ESM), better-sqlite3 |
| **Auth** | JWT (jsonwebtoken) + bcryptjs |
| **AI** | DeepSeek API (proxied server-side) |
| **Security** | Helmet, express-rate-limit, CORS, UUIDv4 |
| **HTTP Client** | Axios (with JWT interceptor) |

---

## 📋 Prerequisites

- **Node.js** v20 or later
- **npm** (comes with Node.js)
- A **DeepSeek API key** ([get one here](https://platform.deepseek.com/)) — required for AI chat and scenario generation

---

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/billsargent/AI-Roleplay.git
cd AI-Roleplay

# Install dependencies
npm install
```

---

## ⚙️ Configuration

All configuration is done through the **Admin Panel** in the app after your first login.

### First-Time Setup
1. Start the server (see below)
2. Register a new account — **the first account automatically becomes admin**
3. Log in and click the **Admin (Shield icon)** button in the nav bar
4. Go to the **System** tab and paste your DeepSeek API key
5. On the **LLM Config** tab, check the model (`deepseek-flash` is a good default), Thinking mode (Off for normal roleplay) and temperature (about 1.0–1.2; higher values drift into nonsense)
6. Set your **Site Name** for branding (optional)

### Optional: Environment Variables
You can also set these via `.env` file in the project root:

```env
PORT=3000                          # Server port (default: 3000)
JWT_SECRET=your-secret-here        # JWT signing secret (generated once and stored in the database if omitted)
CORS_ORIGIN=https://yourdomain.com # Restrict CORS in production
TRUST_PROXY=1                      # Set when running behind a reverse proxy (number of proxies, or "loopback")
TRASH_RETENTION_DAYS=30            # Days before trashed items are permanently deleted (0 = never)
MAX_JSON_BODY_SIZE=250mb           # Largest scenario save/import (only accepted after login)
MEDIUM_JSON_BODY_SIZE=10mb         # Largest chat, persona or AI request
MAX_IMAGE_BYTES=15728640           # Largest single uploaded image, in bytes
LLM_RATE_LIMIT=120                 # AI requests per user per window (admins exempt)
LLM_RATE_WINDOW_MIN=15             # Length of that window in minutes
DB_PATH=./database.sqlite          # Database file location
UPLOADS_DIR=./uploads              # Uploaded images folder
BACKUP_DIR=./backups               # Backups made in the admin panel (default: "backups" next to the database)
MAX_BACKUP_UPLOAD=21474836480      # Largest backup file that can be uploaded, in bytes (default 20 GB)
REQUEST_TIMEOUT_MS=3600000         # Longest a request may take, e.g. uploading a large backup (default 1 hour)
FORCE_HTTPS=false                  # Set to true only when the site is served over HTTPS (tells browsers to use HTTPS only)
```

The site works over plain HTTP on a home network by default. Turn on `FORCE_HTTPS` only once it is reached through HTTPS; on plain HTTP it would make browsers fail to load the page.

---

## 🏃 Running

### Development Mode
Runs the backend server and Vite dev server concurrently with hot reload:
```bash
npm run dev
```
- **Frontend**: http://localhost:5173 (Vite dev server with proxy to backend)
- **Backend**: http://localhost:3000 (Express API)

### Production Build
```bash
# Build the frontend
npm run build

# Start the production server (serves built frontend + API)
npm start
```
- **App**: http://localhost:3000

### Development with Host Access
For testing on mobile devices or network:
```bash
npm run dev:host
```

### Tests
```bash
npm test
```
Runs the unit and end-to-end tests with Node's built-in test runner. End-to-end tests start the server on a throwaway database and uploads folder, and use a fake DeepSeek server, so they never touch real data or call the real API.

### Migrating old base64 images
Databases from before v1.0.8 may still hold images as base64 text. Preview, then run:
```bash
node scripts/migrate-images.js --dry-run
node scripts/migrate-images.js
```
A live run writes a backup copy of the database first.

---

## 📁 Project Structure

```
AI-Roleplay/
├── database/
│   ├── index.js              # SQLite schema, migrations, CRUD operations, seed data
│   └── images.js             # Image file storage (validated paths, save/copy/delete/read)
├── lib/
│   ├── deepseek.js           # Server-side AI request validation and streaming relay
│   ├── prompt.js             # Prompt builder: history budget, lore selection, memories
│   ├── fictionlab.js         # Fictionlab export parser (all export shapes)
│   ├── fictionlabReimport.js # Match export files to scenarios; merge in place
│   ├── loreDoctor.js         # Lore health checks and safe fixes
│   ├── imageType.js          # Detects image type from file bytes
│   ├── safeImageFetch.js     # SSRF-safe remote image download (import flow)
│   └── sanitizeHtml.js       # Server-side rich text sanitizing
├── scripts/
│   └── migrate-images.js     # One-time base64 → file migration
├── tests/                    # node:test unit and end-to-end tests
├── uploads/                  # Uploaded images (created at startup, not in git)
├── src/
│   ├── components/
│   │   ├── AIEnhanceButton.tsx   # AI Enhance for editor fields (word diff, undo)
│   │   ├── AIGeneratorModal.tsx  # AI scenario generation dialog
│   │   ├── LoreFixModal.tsx      # Check & Fix lore dialog
│   │   ├── LoreHealth.tsx        # Admin lore health
│   │   ├── FictionlabReimport.tsx # Admin bulk re-import
│   │   ├── LoreSuggestModal.tsx  # AI lore card suggestions for the editor
│   │   ├── Traits.tsx            # Trait chips and editor input
│   │   ├── MemoryPanel.tsx       # Chat memories: key facts, chapters, edit/pin/write
│   │   ├── Navbar.tsx            # Responsive bottom/top navigation
│   │   ├── PersonaManager.tsx    # User persona CRUD
│   │   ├── RichtextEditor.tsx    # Tiptap editor for scenario introductions
│   │   └── UserEditor.tsx        # Admin user management UI
│   ├── pages/
│   │   ├── AdminPage.tsx         # Admin panel (System, LLM Config, Users)
│   │   ├── AuthPage.tsx          # Login / Register page
│   │   ├── ChatPage.tsx          # Active chat session with streaming AI
│   │   ├── ChatsList.tsx         # Chat history list
│   │   ├── CreateScenario.tsx    # Scenario editor
│   │   ├── Home.tsx              # Scenario discovery
│   │   ├── LandingPage.tsx       # Public landing page
│   │   ├── ScenarioDetail.tsx    # Scenario detail view
│   │   ├── SettingsPage.tsx      # User settings & personas
│   │   └── TrashPage.tsx         # Trash / recycle bin (restore, permanent delete)
│   ├── services/
│   │   ├── api.ts               # Axios client + API service methods
│   │   └── deepseek.ts          # Client for reply, memory and scenario generation endpoints
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── utils/
│   │   ├── cn.ts                # Tailwind classname utility
│   │   ├── diff.ts              # Word diff for AI Enhance
│   │   ├── image.ts             # Image handling (camera/file, resize, import download)
│   │   ├── memories.ts          # Memory chapters, covered messages, progress
│   │   ├── scene.ts             # Reads the AI's scene line (place, day, time)
│   │   ├── notifications.tsx    # Toast & confirm dialog system
│   │   └── sanitize.ts          # Browser-side rich text sanitizing
│   ├── vite-env.d.ts            # Build-time constants (app version)
│   ├── App.tsx                  # Root component, routing, auth guard
│   ├── index.css                # Tailwind entry point + global styles
│   └── main.tsx                 # React entry point
├── server.js                    # Express API server (all routes)
├── package.json
├── vite.config.ts               # Vite config with proxy & Tailwind
├── tsconfig.json
└── index.html                   # HTML entry point
```

---

## 🔌 API Endpoints

### Auth
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/api/register` | Public | Register new account (first user = admin) |
| POST | `/api/login` | Public | Log in, receive JWT token |

### Users & Personas
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/users/me` | Auth | Current user profile + personas |
| GET | `/api/personas` | Auth | List user's personas |
| POST | `/api/personas` | Auth | Create/update persona |
| DELETE | `/api/personas/:id` | Auth | Delete own persona |

### Scenarios
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/scenarios` | Auth | List accessible scenarios (`?page`, `?limit`, `?tab=explore\|mine-public\|mine-private`, `?q=` search) |
| GET | `/api/scenarios/:id` | Auth | Get scenario with characters + lore |
| POST | `/api/scenarios` | Auth | Create/update scenario |
| POST | `/api/import/fictionlab` | Auth | Turn a Fictionlab export into a scenario draft (nothing saved) |
| POST | `/api/scenarios/:id/reimport` | Owner | Update a scenario from its Fictionlab file in place (`apply: false` = preview) |
| DELETE | `/api/scenarios/:id` | Auth | Delete own scenario (or admin) |

### Chats
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/chats` | Auth | List chats (own or all for admin), each with its scenario's name and cover |
| GET | `/api/chats/:id` | Auth | Get chat with messages + memories |
| POST | `/api/chats` | Auth | Create/update chat |
| DELETE | `/api/chats/:id` | Auth | Delete own chat (or admin) |
| DELETE | `/api/chats/all` | Auth | Delete all own chats |
| POST | `/api/chats/:id/reply` | Owner | AI text for a saved chat: `mode` = `reply`, `regenerate`, `continue` or `opening`; `{ stream: true }` for SSE |
| POST | `/api/chats/:id/memory` | Owner | Write a memory card (`{ auto: true }` only when one is due) |

### System (Admin)
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/system/settings` | Admin | Get all system settings (API key masked) |
| POST | `/api/system/settings` | Admin | Update system settings |
| GET | `/api/system/llm-settings` | Auth | Site name and memory limits for the browser |
| GET | `/api/deepseek/models` | Admin | List models available to the configured key |

### User Settings
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/users/settings` | Auth | Get user's color preferences |
| POST | `/api/users/settings` | Auth | Save user's color preferences |

### Admin: User Management
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/admin/users` | Admin | List all users |
| POST | `/api/admin/users` | Admin | Create user |
| PUT | `/api/admin/users/:id` | Admin | Update user |
| DELETE | `/api/admin/users/:id` | Admin | Delete user |
| POST | `/api/admin/fictionlab/match` | Admin | Bulk re-import dry run: match files to scenarios |
| POST | `/api/admin/fictionlab/apply` | Admin | Bulk re-import selected files (backs up the database first) |
| GET | `/api/admin/lore-health` | Admin | Lore health of every scenario (dry run) |
| POST | `/api/admin/lore-health/apply` | Admin | Apply the safe lore fixes everywhere (backs up first) |

### AI Generation
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/api/deepseek/generate` | Auth | AI scenario generation from a description |
| POST | `/api/deepseek/lore-suggest` | Auth | Lore card suggestions for a scenario draft |
| POST | `/api/deepseek/enhance` | Auth | AI Enhance: fixed text for one editor field (`mode`: fix, vivid, condense) |
| POST | `/api/lore/check` | Auth | Lore health of a draft and the safely fixed lore |
| POST | `/api/deepseek/lore-fix` | Auth | AI trigger words, links and summaries for never-sent cards (15 per call) |

Chat replies and memories use the chat endpoints above; the server builds every prompt.

### Images
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/images/{type}/{prefix}/{id}.{ext}` | Public | Serve an uploaded image (ETag revalidation) |
| GET | `/api/proxy-image?url=` | Auth | Download a public image for the import flow (SSRF-protected) |

### User Account
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/api/users/change-password` | Auth | Change password |

### Trash / Recycle Bin
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/trash` | Auth | List all trashed chats and scenarios |
| POST | `/api/trash/restore/chat/:id` | Auth | Restore a trashed chat |
| POST | `/api/trash/restore/scenario/:id` | Auth | Restore a trashed scenario |
| DELETE | `/api/trash/chat/:id` | Auth | Permanently delete a trashed chat |
| DELETE | `/api/trash/scenario/:id` | Auth | Permanently delete a trashed scenario |
| DELETE | `/api/trash/empty` | Auth | Empty all trash items for the current user |

---

## 🔮 Future Options

### 🗄️ MySQL Database Support
Planned support for **MySQL** as an alternative to the current SQLite backend. This would enable:
- **Better concurrency** — Handle multiple simultaneous write operations without locking
- **Larger deployments** — Scale to more users, scenarios, and chats
- **Robust data management** — Native user management, replication, and backup tooling
- **Migration tooling** — A future migration path from SQLite to MySQL will be provided

### 🤖 Multi-Model AI Support
Currently powered exclusively by **DeepSeek**. Future updates may add support for additional LLM providers:

| Provider | Models |
|----------|--------|
| **OpenAI** | GPT-4, GPT-4o, GPT-4o-mini |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 Haiku, Claude 4 |
| **OpenRouter** | Unified API accessing 200+ models including Mixtral, Llama, and more |
| **Local / Self-Hosted** | Ollama, LM Studio, llama.cpp (run models entirely on your own hardware) |

This would give users the flexibility to choose the model that best fits their needs — whether prioritizing cost, speed, quality, or privacy.

---

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add my feature'`
4. Push the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is open source and available under the MIT License.
