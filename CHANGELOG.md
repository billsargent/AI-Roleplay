# Changelog

## [v2.0.0] - 2026-10-15

A major release: security and data-loss fixes from a code audit (GitHub issues #1–#10), a rebuilt roleplay engine with prompts assembled on the server (#11–#17), and a new chat and editor layout (#30–#33).

### Upgrading from 1.x
- **Back up `database.sqlite` and `uploads/` first.** The schema is migrated automatically on start (new columns and indexes only).
- **Node.js 20 or later** is required. Run `npm install` (the lock file is now committed) and `npm run build`.
- **Admin › LLM Config:** pick a current model (`deepseek-flash` or `deepseek-v4-pro`; DeepSeek scheduled `deepseek-chat` and `deepseek-reasoner` for retirement on 2026-07-24), set **Thinking mode** (Off uses temperature and penalties; On ignores them), and check **temperature** (about 1.0–1.2 for roleplay; 1.5 produced nonsense in testing). Negative frequency/presence penalties now take effect and encourage repetition; 0 is the safe value.
- **New Context & Lore settings** (context budget, lore scan depth and caps) default to sensible values; review them once.
- Optional environment variables are listed in the README (`TRUST_PROXY` matters behind a reverse proxy).
- Trash older than `TRASH_RETENTION_DAYS` (default 30) is purged on the first start.

### Breaking
- The generic AI endpoints `/api/deepseek/chat` and `/api/deepseek/chat/stream` are removed. Clients ask for a reply to a saved chat with `POST /api/chats/:id/reply` and the server builds the prompt; memories use `POST /api/chats/:id/memory`.
- `/api/system/deepseek-key` is removed; the key is only ever returned masked.
- The "Chat Padding" and "Memory Send Interval" admin settings are removed (the chat lays itself out, and memories are sent every turn).
- Only the chat owner can ask the AI to reply in a chat (admins viewing another user's chat are read-only).

### Security
- **Image paths** — Image reads, writes and deletes only accept the `{type}/{prefix}/{id}.{ext}` layout inside the uploads folder. Previously a crafted path could read files such as the database, and a crafted avatar path could delete arbitrary files. Image URLs pointing at another entity's file are copied, never shared.
- **Image proxy** — `/api/proxy-image` requires login and only fetches public http(s) addresses (checked at connect time and on every redirect), with a timeout, a 10 MB cap and the type detected from the bytes.
- **Ownership** — Users can no longer overwrite another user's persona, or take over another scenario's characters or lore by reusing their ids.
- **XSS** — Scenario introductions are sanitized on save (sanitize-html) and before display (DOMPurify). The CSP no longer allows inline or eval script.
- **Request size** — The 250 MB body limit only applies to scenario saves after login; everything else is 1 MB (chats, personas and AI requests 10 MB).
- **AI proxy** — The server picks the model, caps reply length and clamps sampling values; per-user AI rate limit; DeepSeek errors return 502 instead of looking like an expired session.
- **Accounts** — Tokens stop working when a user is deleted or changes password; the first-admin assignment is atomic; admin user edits are validated and the last admin cannot be demoted; login timing no longer reveals which usernames exist.
- **Dependencies** — `npm audit` from 40 known vulnerabilities to 0 (patch updates, Tiptap 3.31.4, Vite 7.3.6).
- The DeepSeek key is only returned masked; the raw-key endpoint was removed.

### Fixed
- Editing a scenario no longer deletes its character avatars.
- Trash auto-purge after 30 days now actually runs (it was documented in v1.0.4 but never scheduled). Configurable with `TRASH_RETENTION_DAYS`.
- Replaced images now show up: images use ETag revalidation instead of a one-year immutable cache (v1.0.8 said images get new paths on update; they do not).
- Base64 copies are no longer written into the database on every save; `migrate-images.js --dry-run` no longer writes files, and a live run backs up the database first.
- Orphan image files are removed when users, scenarios or introduction images are deleted.
- Chat: Stop and Retry; partial replies are kept; memory generation no longer blocks or gets overwritten; Enter while the AI replies keeps your text; switching chats quickly no longer shows the wrong chat; custom instructions save once instead of on every keystroke.
- Home search and tabs now cover all scenarios, not only the current page; the chat list no longer labels chats of later scenarios as deleted.
- Message `versions` were JSON-encoded again on every save; existing rows are repaired when read.
- Restarting the server no longer signs everyone out (the JWT secret is kept in the database when `JWT_SECRET` is not set).
- `.env` files are now loaded (they were documented but ignored).
- The admin "API Rate Limit" field now takes effect.
- Imported introductions keep their centred/right alignment.

### Roleplay engine
- **Prompts are built on the server** (`lib/prompt.js`) from the saved chat and scenario. Players can no longer send arbitrary prompts through the site's API key, and "Hide prompts" and hidden lore are enforced for other users.
- **Long chats work:** the newest history that fits a configurable token budget is sent; older turns are covered by memories instead of eventually failing with a context-length error.
- **Rolling memories:** each memory summarises everything since the previous one (it used to cover only the last 10 messages), all memories are sent with every reply (unpinned ones used to be sent only every 25th turn), and `*continue*` turns no longer count toward the interval.
- **Lore triggers** match whole words only ("art" no longer fires on "party"), look only at recent messages, are ordered by priority, and the caps are configurable. One "Sent to the AI" selector (When triggered / Always / Never) replaces three conflicting checkboxes; lore can be hidden from players.
- **Prompt cleanups:** concrete length targets, no doubled punctuation, chat notices are not sent to the AI, character lore that repeats a cast member is skipped, and two new per-scenario switches: *Action* / "Dialogue" formatting rule and sending the introduction to the AI.
- **Current DeepSeek models** with a Thinking mode setting; the reply-length cap works (thinking gets extra headroom).

### Added
- Admin switch to close new sign-ups.
- Database indexes; `npm test` with unit and end-to-end tests.
- Settings: `TRUST_PROXY`, `TRASH_RETENTION_DAYS`, `MEDIUM_JSON_BODY_SIZE`, `MAX_IMAGE_BYTES`, `LLM_RATE_LIMIT`, `LLM_RATE_WINDOW_MIN`, `DB_PATH`, `UPLOADS_DIR`.

### Changed
- Requires Node.js 20 or later. `package-lock.json` is committed.
- **Chat layout** — The chat fits the space under the navbar, the input box is part of the page and can no longer cover messages (or hide behind the navbar on phones), and messages sit in a centred reading column. The admin "Chat Padding" setting is removed. Scrolling follows new text only while you are at the bottom; a "New messages" button appears when you have scrolled up. The input grows with its text. New chat header with scenario info, memories and settings.
- **Scenario editor** — One wide column with all switches in a "Settings & Publishing" section at the end; fields grow with their text; sticky section navigation and save bar with an unsaved-changes marker; leaving with unsaved edits asks first.
- New characters and lore cards start empty (placeholder text such as "Role/Brief bio" was saved as real prompt content).
- Chat messages show the scenario image and persona avatar; one accent colour; larger reading text.
- Rich text (introductions and their editor) now gets heading, list and quote styles (`@tailwindcss/typography` was never installed).

## [v1.0.9] - 2026-07-27

### Fixed
- **Chats List showing "No chats found" after pagination refactor** — The v1.0.8 commit changed `apiService.getScenarios()` to return a pagination envelope (`{ scenarios, pagination }`) instead of a plain array, but `ChatsList.tsx` was not updated. It called `.forEach()` on the envelope object, causing a silent `TypeError` that prevented all chats and scenarios from loading. Fixed by extracting `.scenarios` from the pagination response with a safe fallback.

## [v1.0.8] - 2026-07-20

### Added
- **File-System Image Storage** - Images are no longer stored as base64 blobs in the SQLite database. Instead, they are extracted to the file system under uploads/{type}/{prefix}/{id}.{ext} with a 256-bucket directory structure.
  - New database/images.js module with utilities: saveImage(), deleteImage(), copyImage(), readImage(), resolveImageUrl(), ensureUploadsDirs(), parseDataUrl(), relativePath()
  - Schema migrations: image_path column on scenarios, avatar_path on characters, lore_pieces, and personas
  - Automatic image extraction on save: saveScenarioTransaction() and upsertPersona() now extract base64 images to disk and store the relative path
  - Image cleanup on delete: permanentlyDeleteScenarioById() and deletePersonaById() clean up associated image files
- **Image Serving Endpoint** - GET /api/images/* serves uploaded images with 1-year immutable cache headers. Placed before the rate limiter for performance.
- **One-Time Migration Script** - scripts/migrate-images.js migrates existing base64 blobs from scenarios.image, characters.avatar, and personas.avatar to the file system, then clears the base64 from the database.
- **Introduction Embedded Image Migration** - The migration script also extracts embedded base64 images from the rich-text scenarios.introduction HTML field, replacing data URLs with /api/images/embedded/ paths. New extractIntroImages() and cleanupIntroImages() functions handle this on future saves and permanent deletes.
- **Top Pagination** - Pagination controls (Previous/Page X of Y/Next) now appear at both the top and bottom of the scenario grid on the Home page.

### Changed
- **.gitignore** - Added uploads/ and *.tar.gz to prevent user-generated images and backup archives from being committed to the repository.

### Fixed
- **Cross-platform image paths** - Embedded image URLs in introductions now include the correct prefix subdirectory (e.g., /api/images/embedded/78/abc...webp instead of /api/images/embedded/abc...webp), fixing broken images on all platforms.

## [v1.0.7] — 2026-05-13

### Fixed
- **Scenario Export Missing Introduction & Cover Image** — The export function in `ScenarioDetail.tsx` now includes `customIntroduction` (rich HTML with embedded base64 images) and `mainImage` (cover image) so that the complete scenario — including formatted text and images — is preserved across export/import. Lore piece `avatarURL` was also fixed to use the actual avatar value instead of being hardcoded to `null`.

## [v1.0.6] — 2026-05-11

### Added
- **Rich Text Editor (Introduction)** — A full-featured rich text editor (Tiptap) for creating an "Introduction" section in scenarios. Supports bold, italic, underline, headings (H1/H2/H3), bullet/ordered lists, blockquotes, text alignment, hyperlinks, embedded images (base64, 5MB limit), and undo/redo.
- **Introduction Rendering** — The Introduction content (HTML with images and formatting) is rendered in `ScenarioDetail.tsx` between the Story Description and The Backstory sections. If no introduction is supplied, it is conditionally hidden.
- **New Component: `RichtextEditor.tsx`** — Reusable Tiptap-based rich text editor with a floating BubbleMenu for inline formatting on text selection.
- **Database Migration** — Added `introduction TEXT` column to the `scenarios` table for storing rich text HTML content.

## [v1.0.5] — 2026-05-11

### Added
- **Landing / Welcome Page** — Site root (`/`) now shows a welcome page with site description, feature overview cards, and a Help & Tips section explaining how to create scenarios, use custom instructions, and tips & tricks. Unauthenticated visitors see a "Sign In" button; authenticated users see "Explore Scenarios" and "Create New" buttons.
- **3-Tab Scenario Browser** — The Home/Explore page now has three tabs: "Explore" (all public scenarios), "My Public" (user's own public scenarios), and "My Private" (user's own private/hidden scenarios). Private scenarios are never shown in Explore.

### Changed
- **Routing Restructure** — Migrated to React Router v6 layout routes. Protected routes now share a common layout (`AuthenticatedApp`) that renders the Navbar, so the navigation bar appears on **all** authenticated pages (scenarios, create, chats, settings, admin, etc.), not just the scenario browser.
- **Navbar Simplified** — Removed the redundant "Home" nav link (which pointed to `/`). The "Explore" link is now the primary entry point for browsing scenarios at `/scenarios`.

### Fixed
- **TypeScript Error TS6133** — Fixed unused `user` variable in `App.tsx` that prevented compilation.

## [v1.0.4] — 2026-05-08

### Added
- **Lore Card Expand/Collapse** — Truncated lore card text in both the scenario preview (ScenarioDetail) and the Memory Matrix Lore Database tab can now be expanded with a "more..." / "less" toggle to view full content.

### Fixed
- **Lore Cards Hidden in Scenario Preview** — Lore cards and backstory sections were hidden when `hidePrompts` was enabled in scenario settings. They now always display regardless of this setting.
- **Narrow Scenario Detail Layout** — The scenario preview page used a cramped `max-w-5xl` container. Widened to `max-w-7xl` for better readability.

## [v1.0.3] — 2026-05-05

### Changed
- **Restructured Prompt Layering** — Moved global instructions from the system prompt prefix to a post-conversation final reminder. This improves response quality by placing tone/style instructions immediately before the model's response, where they have stronger recency influence, while keeping the system prompt focused on core roleplay setup (scenario, personas, characters, lore).

## [v1.0.2] — 2026-05-01

### Added
- **"Continue" Button in Chat** — A small purple play button now appears under the last AI message. Clicking it sends `*continue*` to the LLM to push the story forward without typing. Only visible when the last message is from the assistant and the chat is not read-only.

### Fixed
- **Rate Limiter Lockouts on Fresh Deploy** — Completely rewrote the rate limiter logic to prevent false 429 errors:
  - Auth endpoints (`/api/login`, `/api/register`) are now properly skipped by the general rate limiter (they have their own dedicated `authLimiter`). Previously, the `skip` function checked `req.path === '/api/login'` which could never match because Express mounts middleware at `/api`, making `req.path` relative (`/login`).
  - Admin bypass now uses the synchronous `skip` function instead of an async `max` returning `0`, eliminating race conditions where the request counter could increment before the async resolution completed.
  - Increased default limit from 200 to 1000 requests per 15-minute window.
- **UNIQUE Constraint Violations on Scenario Import** — Imported scenarios could cause `UNIQUE constraint failed: lore_pieces.id` errors on re-import because lore pieces and characters kept their original IDs from the JSON file. Fixed by always generating fresh UUIDs in the import handler, with `INSERT OR REPLACE` as a database-level safety net.

### Changed
- **Removed `package-lock.json` from Git tracking** — Added to `.gitignore` and deleted from repository to avoid merge conflicts across environments. Developers should rely on `npm install` to generate their own lockfile.
- **Extracted `sendMessage(text)` from `handleSend`** — Refactored to allow the Continue button and any future features to send messages without going through the input field.

## [v1.0.1] — 2026-04-30


### Added
- **Deleted Scenario Handling** — When a scenario creator deletes their scenario (soft-delete), users with active chats in that scenario now see a red "scenario deleted by creator" banner and the chat enters read-only mode
- **Chat Export** — Two export options added to Chat Settings:
  - **Export JSON** — Downloads the full chat (messages, metadata, settings) as a JSON file
  - **Export PDF** — Uses `jsPDF` to build a formatted PDF with sender headers, timestamps, word-wrapped content, and automatic page breaks. AI memories are appended as a separate section at the end of the PDF. Colors are print-optimized (dark text on white) regardless of the user's app theme.
  - Export buttons are always visible in Chat Settings, even in read-only mode (deleted scenario or admin viewing)
- **Trash / Recycle Bin** — Soft-delete system for chats and scenarios:
  - Deleted items are moved to trash instead of being permanently removed immediately
  - New Trash page accessible from Settings (also at `/trash`)
  - Restore individual items or permanently delete them
  - Empty trash to remove all deleted items at once
  - Automatic 30-day purge for expired trash items
  - Confirmation dialogs and success toasts for all trash actions
  - Soft-deleted items are filtered from active chats, scenarios, and admin views
  - Orphan protection: when a scenario is permanently deleted, associated chats are preserved in read-only mode with all messages, memories, and settings intact
- **Configurable Rate Limiting** — API rate limit is now configurable from the admin panel (System tab). Admins are exempt from rate limiting. Users who hit the limit see a friendly toast notification instead of a silent failure.

### Fixed
- **PDF Export Failure** — Replaced `html2canvas` DOM capture with `jsPDF` native text rendering. The previous approach failed because the chat messages area was hidden behind the full-screen Chat Settings overlay, causing html2canvas to capture a blank/empty canvas.
- **"Unknown Scenario" in Trash Page** — Deleted chats in the trash list always showed "Unknown" for the scenario name because `enrichChat()` didn't include a `scenarioName` field. The backend now looks up the scenario name from the `scenarios` table and attaches it to each trashed chat.
- **`npm start` now serves the latest frontend build** — Updated the start script in `package.json` from `node server.js` to `vite build && node server.js`. Previously, `npm start` would serve the stale pre-built `dist/` folder, which caused:
  - Settings / User Profile page showing an old version without the change password feature and username display
  - Home page not filtering user's own scenarios correctly (showing them on the main Explore tab instead of only under "My Scenarios")

## [v1.0.0] — 2026-03-01
- Initial release
- Scenario system with AI-powered generation
- AI chat with streaming responses
- Character and persona management
- Lore system with smart activation
- Admin panel with LLM configuration
- JWT authentication
- User settings and customization
