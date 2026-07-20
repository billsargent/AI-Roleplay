/**
 * ─── Image File System Utilities ───
 *
 * Handles saving, deleting, copying, and serving images from the file system.
 * Images are stored under:
 *   uploads/{entityType}/{prefix}/{id}.{ext}
 *
 * Where {prefix} is the first 2 hex characters of the UUID (256 buckets)
 * and {ext} is derived from the base64 data URL or saved extension.
 *
 * This replaces the previous approach of storing base64 data URLs directly
 * in SQLite TEXT columns, which bloated the database and slowed API responses.
 *
 * @module images
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root uploads directory (sibling to the database/ directory) */
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');

/** All supported entity types that can have images */
export const ENTITY_TYPES = ['scenarios', 'characters', 'personas', 'lore-pieces', 'embedded'];

/**
 * Ensures the uploads directory structure exists, creating it if needed.
 * Called once on server startup.
 */
export function ensureUploadsDirs() {
  for (const entityType of ENTITY_TYPES) {
    const dir = path.join(UPLOADS_ROOT, entityType);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  console.log(`📁 Uploads directory ready: ${UPLOADS_ROOT}`);
}

/**
 * Gets the 2-character hex prefix from a UUID (first 2 hex digits).
 * This provides 256 buckets for even distribution without deep nesting.
 * Example: "a1b2c3d4-..." -> "a1"
 *
 * @param {string} id - UUID string
 * @returns {string} 2-character prefix
 */
function getPrefix(id) {
  return id.substring(0, 2);
}

/**
 * Maps a MIME type to a file extension.
 * @param {string} mimeType - e.g., "image/webp", "image/jpeg", "image/png"
 * @returns {string} File extension without dot (e.g., "webp", "jpg", "png")
 */
function mimeToExt(mimeType) {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  return map[mimeType] || 'webp';
}

/**
 * Determines the file extension from a base64 data URL.
 * @param {string} dataUrl - e.g., "data:image/webp;base64,..."
 * @returns {string} Extension (e.g., "webp")
 */
export function extFromDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
  if (match) {
    return mimeToExt('image/' + match[1]);
  }
  return 'webp';
}

/**
 * Extracts the raw base64 data from a data URL.
 * @param {string} dataUrl - e.g., "data:image/webp;base64,UklGR..."
 * @returns {{ base64: string, ext: string }} The raw base64 string and file extension
 */
export function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (match) {
    return {
      base64: match[2],
      ext: mimeToExt('image/' + match[1]),
    };
  }
  return null;
}

/**
 * Computes the relative path for an image file.
 * Format: "{entityType}/{prefix}/{id}.{ext}"
 *
 * @param {string} entityType - One of ENTITY_TYPES
 * @param {string} id - UUID of the owning entity
 * @param {string} ext - File extension
 * @returns {string} Relative path like "scenarios/a1/a1b2c3d4-....jpg"
 */
export function relativePath(entityType, id, ext) {
  const prefix = getPrefix(id);
  return `${entityType}/${prefix}/${id}.${ext}`;
}

/**
 * Returns the absolute file path for an image.
 * @param {string} relative - Relative path from relativePath()
 * @returns {string} Absolute path on disk
 */
export function absolutePath(relative) {
  return path.join(UPLOADS_ROOT, relative);
}

/**
 * Saves a base64 data URL to disk as an image file.
 *
 * @param {string} dataUrl - Base64 data URL string (or empty string/URL to skip)
 * @param {string} entityType - Entity type folder name
 * @param {string} entityId - UUID of the owning entity
 * @returns {string|null} Relative path to the saved file, or null if no image saved
 */
export function saveImage(dataUrl, entityType, entityId) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return null;
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;

  const relPath = relativePath(entityType, entityId, parsed.ext);
  const absPath = absolutePath(relPath);

  // Ensure the prefix subdirectory exists
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absPath, Buffer.from(parsed.base64, 'base64'));
  return relPath;
}

/**
 * Deletes an image file from disk by its relative path.
 * Does nothing if the file does not exist (idempotent).
 *
 * @param {string} relPath - Relative path from relativePath() or DB
 */
export function deleteImage(relPath) {
  if (!relPath) return;
  const absPath = absolutePath(relPath);
  try {
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  } catch (err) {
    console.error(`Failed to delete image: ${absPath}`, err);
  }
}

/**
 * Copies an image file from one path to another (used when copying scenarios).
 * If source doesn't exist, returns null silently.
 *
 * @param {string} sourceRelPath - Relative path of source image
 * @param {string} destEntityType - Entity type for the destination
 * @param {string} destEntityId - UUID of the destination entity
 * @returns {string|null} Relative path of the copied image, or null
 */
export function copyImage(sourceRelPath, destEntityType, destEntityId) {
  if (!sourceRelPath) return null;

  const srcAbs = absolutePath(sourceRelPath);
  if (!fs.existsSync(srcAbs)) return null;

  // Extract extension from source path
  const ext = path.extname(sourceRelPath).replace('.', '') || 'webp';
  const destRelPath = relativePath(destEntityType, destEntityId, ext);
  const destAbs = absolutePath(destRelPath);

  const dir = path.dirname(destAbs);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.copyFileSync(srcAbs, destAbs);
  return destRelPath;
}

/**
 * Reads an image file from disk and returns the content type and raw buffer.
 * Returns null if the file does not exist.
 *
 * @param {string} relPath - Relative path to the image
 * @returns {{ contentType: string, buffer: Buffer }|null}
 */
export function readImage(relPath) {
  if (!relPath) return null;
  const absPath = absolutePath(relPath);
  try {
    if (!fs.existsSync(absPath)) return null;
    const ext = path.extname(relPath).replace('.', '');
    const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const buffer = fs.readFileSync(absPath);
    return { contentType, buffer };
  } catch (err) {
    console.error(`Failed to read image: ${absPath}`, err);
    return null;
  }
}

/**
 * Given either a base64 data URL or a relative image path, resolves
 * the image URL that the frontend can use to display the image.
 *
 * If relPath is already set, returns an API URL.
 * If dataUrl is a base64 string, returns it as-is (legacy support).
 * If neither, returns empty string.
 *
 * @param {string} imageField - The raw image value from DB (base64 or path)
 * @param {string} imagePathField - The image_path value from DB
 * @returns {string} URL or base64 data URL for the frontend
 */
export function resolveImageUrl(imageField, imagePathField) {
  // Prefer file path over base64
  if (imagePathField) {
    return `/api/images/${imagePathField.replace(/\\/g, '/')}`;
  }
  // Fall back to base64 (legacy data)
  if (imageField && imageField.startsWith('data:image/')) {
    return imageField;
  }
  // Plain URL (e.g., Unsplash URLs for default scenarios)
  if (imageField && (imageField.startsWith('http://') || imageField.startsWith('https://'))) {
    return imageField;
  }
  return '';
}
