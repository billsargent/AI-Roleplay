# Changelog

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
