# AI Roleplay

An immersive, AI-powered roleplay platform where you create stories, build worlds, and chat with intelligent AI characters. Built with a modern React frontend and an Express + SQLite backend, powered by the DeepSeek language model.

---

## ✨ Features

### 📖 Scenario System
- **Create & Edit Rich Scenarios** — Full-featured editor with backstory, cast of characters, lore pieces, and custom instructions
- **AI-Powered Generation** — Describe a scenario in natural language and the AI builds a complete world with characters and lore
- **Public / Private Scenarios** — Share your creations with the community or keep them private
- **Copy & Customize** — Fork any public scenario and make it your own
- **Tag-Based Discovery** — Search and browse community scenarios by name, tags, or creator
- **Scenario Detail View** — Inspect full backstory, character profiles, and lore before playing

### 🤖 AI Chat & Roleplay
- **Real-Time Streaming** — AI responses stream character-by-character via Server-Sent Events (SSE) for instant feedback
- **Context-Aware Responses** — The AI has full knowledge of the world setting, characters, lore pieces, and conversation history
- **Smart Lore Activation** — Lore pieces with keyword triggers automatically include themselves when mentioned in conversation
- **Memory System** — The AI generates concise memory cards at configurable intervals to retain long-term context
- **Response Length Control** — Choose short, medium, or long AI responses
- **Message Editing & Versioning** — Edit your messages and the AI will regenerate its response; previous versions are preserved

### 🧩 Characters & Personas
- **Multi-Character Casts** — Scenarios can have any number of NPCs with names, descriptions, and personality profiles
- **User Personas** — Create multiple character profiles (personas) to use across different scenarios
- **Character Avatars** — Upload images for both NPCs and user personas (supports base64 from camera or file picker)
- **Force Character Mode** — Lock the AI into roleplaying as a specific character

### 🧠 Lore System
- **Lore Pieces** — Define locations, events, objects, and other world-building elements
- **Pinned Lore** — Always included in the AI context for essential world knowledge
- **Smart Activation** — Lore pieces auto-activate when trigger keywords appear in recent conversation
- **Linked Pieces** — Connect related lore together
- **Weight-Based Priority** — Control which lore the AI prioritizes

### 👤 User System
- **JWT Authentication** — Secure token-based auth with 7-day session expiry
- **Registration & Login** — First user auto-gains admin role
- **Password Management** — Change your password with current verification
- **Trash / Recycle Bin** — Deleted chats and scenarios go to trash instead of being permanently removed. Restore them or permanently delete from the Trash page in Settings. Items auto-purge after 30 days.
- **Chat Appearance Customization** — Set your own dialog highlight color, narration text color, and chat bubble background color

### 🛠️ Admin Panel
- **DeepSeek API Key Configuration** — Securely set and manage the AI provider key (never exposed to clients)
- **LLM Parameters** — Configure temperature, max tokens, frequency/presence penalties
- **Response Token Limits** — Set short/medium/long response token caps
- **Memory Management** — Configure memory send interval, generation interval, word count, and max retention
- **Site Branding** — Custom site name displayed throughout the app
- **User Management** — View, create, edit, and delete users with role assignment

### 🔒 Security
- **Server-Side API Key** — DeepSeek API key is stored server-side, proxied through backend endpoints, never sent to the browser
- **Helmet CSP** — Content Security Policy prevents XSS and data injection attacks
- **Rate Limiting** — General API (200/15min) and auth-specific (20/15min) rate limiting
- **SQL Injection Protection** — All queries use parameterized statements (better-sqlite3)
- **Input Validation** — Password length enforcement, user settings key allowlist
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

- **Node.js** v18 or later
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
5. Configure LLM parameters on the **LLM Config** tab (optional)
6. Set your **Site Name** for branding (optional)

### Optional: Environment Variables
You can also set these via `.env` file in the project root:

```env
PORT=3000                          # Server port (default: 3000)
JWT_SECRET=your-secret-here        # JWT signing secret (auto-generated if omitted)
CORS_ORIGIN=https://yourdomain.com # Restrict CORS in production
```

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

---

## 📁 Project Structure

```
AI-Roleplay/
├── database/
│   └── index.js              # SQLite schema, CRUD operations, seed data
├── src/
│   ├── components/
│   │   ├── AIGeneratorModal.tsx  # AI scenario generation dialog
│   │   ├── Navbar.tsx            # Responsive bottom/top navigation
│   │   ├── PersonaManager.tsx    # User persona CRUD
│   │   └── UserEditor.tsx        # Admin user management UI
│   ├── pages/
│   │   ├── AdminPage.tsx         # Admin panel (System, LLM Config, Users)
│   │   ├── AuthPage.tsx          # Login / Register page
│   │   ├── ChatPage.tsx          # Active chat session with streaming AI
│   │   ├── ChatsList.tsx         # Chat history list
│   │   ├── CreateScenario.tsx    # Scenario editor
│   │   ├── Home.tsx              # Scenario discovery / landing page
│   │   ├── ScenarioDetail.tsx    # Scenario detail view
│   │   ├── SettingsPage.tsx      # User settings & personas
│   │   └── TrashPage.tsx         # Trash / recycle bin (restore, permanent delete)
│   ├── services/
│   │   ├── api.ts               # Axios client + API service methods
│   │   └── deepseek.ts          # AI prompt assembly + proxy calls
│   ├── types/
│   │   └── index.ts             # TypeScript interfaces
│   ├── utils/
│   │   ├── cn.ts                # Tailwind classname utility
│   │   ├── image.ts             # Image handling (camera/file, resize)
│   │   └── notifications.tsx    # Toast & confirm dialog system
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
| GET | `/api/scenarios` | Auth | List accessible scenarios |
| GET | `/api/scenarios/:id` | Auth | Get scenario with characters + lore |
| POST | `/api/scenarios` | Auth | Create/update scenario |
| DELETE | `/api/scenarios/:id` | Auth | Delete own scenario (or admin) |

### Chats
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/chats` | Auth | List chats (own or all for admin) |
| GET | `/api/chats/:id` | Auth | Get chat with messages + memories |
| POST | `/api/chats` | Auth | Create/update chat |
| DELETE | `/api/chats/:id` | Auth | Delete own chat (or admin) |
| DELETE | `/api/chats/all` | Auth | Delete all own chats |

### System (Admin)
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| GET | `/api/system/settings` | Admin | Get all system settings |
| POST | `/api/system/settings` | Admin | Update system settings |
| GET | `/api/system/deepseek-key` | Admin | Get API key (masked in response) |
| GET | `/api/system/llm-settings` | Auth | Get LLM configuration |

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

### AI Proxy (Server-Side)
| Method | Path | Access | Description |
|--------|------|--------|-------------|
| POST | `/api/deepseek/chat` | Auth | Non-streaming AI chat |
| POST | `/api/deepseek/chat/stream` | Auth | SSE streaming AI chat |
| POST | `/api/deepseek/generate` | Auth | AI scenario generation |

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
