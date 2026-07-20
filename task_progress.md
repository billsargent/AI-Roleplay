# File-System Image Storage Migration

## Todo

- [x] Create `database/images.js` - Image file utilities (save, delete, copy, extension detection)
- [x] Update `database/index.js` - Add `image_path` columns to schema via safe migrations
- [x] Modify `database/index.js` - Update scenario/character/lore read functions for image_path handling
- [x] Update `database/index.js` - Update `saveScenarioTransaction()` to extract images to disk
- [x] Update `database/index.js` - Update `upsertPersona()` to extract avatars to disk
- [x] Update `database/index.js` - Update `getPersonasByUserId()` and `getUserWithPersonas()` to resolve avatar URLs
- [x] Update `database/index.js` - Add image cleanup to `permanentlyDeleteScenarioById()` and `deletePersonaById()`
- [x] Update `server.js` - Import image utilities and call `ensureUploadsDirs()`
- [x] Update `server.js` - Add image serving endpoint (`GET /api/images/*`)
- [x] Update `server.js` - Update CSP for image serving (`/api/images/`)
- [x] Create `scripts/migrate-images.js` - One-time migration tool to export base64 images to filesystem
- [x] Update `scripts/migrate-images.js` - Add embedded image extraction from scenario introductions
- [x] Update `database/index.js` - Add `extractIntroImages()` for introduction image extraction on save
- [x] Update `database/index.js` - Add `cleanupIntroImages()` for cleanup on permanent delete
- [x] Run the migration script
- [x] Test and fix embedded image URL prefix issue
