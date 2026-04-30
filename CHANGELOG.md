# Changelog

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
