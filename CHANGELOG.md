# Changelog

## [Unreleased]

### Fixed
- **`npm start` now serves the latest frontend build** — Updated the start script in `package.json` from `node server.js` to `vite build && node server.js`. Previously, `npm start` would serve the stale pre-built `dist/` folder, which caused:
  - Settings / User Profile page showing an old version without the change password feature and username display
  - Home page not filtering user's own scenarios correctly (showing them on the main Explore tab instead of only under "My Scenarios")
