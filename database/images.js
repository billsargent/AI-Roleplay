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
import { sniffImageType } from '../lib/imageType.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Root uploads directory (sibling to the database/ directory; UPLOADS_DIR overrides, e.g. for tests) */
const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));

/** The uploads root folder (for backups) */
export const uploadsRoot = () => UPLOADS_ROOT;

/** All supported entity types that can have images */
export const ENTITY_TYPES = ['scenarios', 'characters', 'personas', 'lore-pieces', 'embedded'];

/** Largest image accepted for storage (decoded bytes) */
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_BYTES) || 15 * 1024 * 1024;

/** File extensions we store and serve. SVG is excluded because it can carry script. */
const ALLOWED_EXTS = ['jpg', 'png', 'gif', 'webp', 'bmp'];

/** Entity ids are UUIDs, or "{uuid prefix}_{hash}" for embedded images */
const ID_RE = /^[0-9A-Za-z_-]{2,80}$/;

/** The only relative path shape we ever read, write or delete: "{entityType}/{prefix}/{id}.{ext}" */
const REL_PATH_RE = new RegExp(
  `^(${ENTITY_TYPES.join('|')})/[0-9A-Za-z_-]{2}/[0-9A-Za-z_-]{1,80}\\.(${ALLOWED_EXTS.join('|')})$`
);

/** Normalizes Windows separators so stored paths compare consistently */
function normalizeRel(rel) {
  return typeof rel === 'string' ? rel.replace(/\\/g, '/') : '';
}

/**
 * Checks that a relative image path has the exact storage layout.
 * Rejects "..", absolute paths, unknown folders and unknown extensions.
 * @param {string} rel
 * @returns {boolean}
 */
export function isValidImagePath(rel) {
  return REL_PATH_RE.test(normalizeRel(rel));
}

/** Checks that an entity id is safe to use in a file name */
export function isValidEntityId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

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
    'image/bmp': 'bmp',
  };
  return map[mimeType] || null;
}

/**
 * Determines the file extension from a base64 data URL.
 * @param {string} dataUrl - e.g., "data:image/webp;base64,..."
 * @returns {string} Extension (e.g., "webp")
 */
export function extFromDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,/);
  return match ? mimeToExt('image/' + match[1].toLowerCase()) : null;
}

/**
 * Extracts the raw base64 data from a data URL.
 * Returns null for unsupported image types (including SVG).
 * @param {string} dataUrl - e.g., "data:image/webp;base64,UklGR..."
 * @returns {{ base64: string, ext: string }|null} The raw base64 string and file extension
 */
export function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!match) return null;
  const ext = mimeToExt('image/' + match[1].toLowerCase());
  return ext ? { base64: match[2], ext } : null;
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
 * Returns the absolute file path for an image, or null when the relative
 * path is not a valid image path or would resolve outside the uploads folder.
 * Every disk operation goes through this check.
 * @param {string} relative - Relative path from relativePath() or the DB
 * @returns {string|null} Absolute path on disk
 */
export function absolutePath(relative) {
  if (!isValidImagePath(relative)) return null;
  const abs = path.resolve(UPLOADS_ROOT, normalizeRel(relative));
  return abs.startsWith(UPLOADS_ROOT + path.sep) ? abs : null;
}

/**
 * Extracts and validates the relative path from an "/api/images/..." URL.
 * @param {string} url
 * @returns {string|null} Valid relative path, or null
 */
export function imagePathFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/api/images/')) return null;
  const rel = url.slice('/api/images/'.length);
  return isValidImagePath(rel) ? normalizeRel(rel) : null;
}

/** True when a relative path is the image slot of the given entity */
function isOwnedBy(rel, entityType, entityId) {
  return normalizeRel(rel).startsWith(`${entityType}/${getPrefix(entityId)}/${entityId}.`);
}

/**
 * Resolves an "/api/images/..." URL sent by the client into a path that
 * belongs to the given entity. If the URL points at another entity's file
 * (for example a scenario being copied), the file is copied into this
 * entity's own slot so later deletes never touch someone else's file.
 *
 * @param {string} url - Image URL from the client
 * @param {string} entityType - Entity type folder name
 * @param {string} entityId - UUID of the owning entity
 * @returns {string|null} Relative path owned by the entity, or null
 */
export function adoptImage(url, entityType, entityId) {
  const rel = imagePathFromUrl(url);
  if (!rel || !ENTITY_TYPES.includes(entityType) || !isValidEntityId(entityId)) return null;
  if (isOwnedBy(rel, entityType, entityId)) return rel;
  return copyImage(rel, entityType, entityId);
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
  if (!ENTITY_TYPES.includes(entityType) || !isValidEntityId(entityId)) return null;

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;

  // Check the real bytes, not the declared type: it must be an image we support
  const buffer = Buffer.from(parsed.base64, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  const type = sniffImageType(buffer);
  if (!type) return null;

  const relPath = relativePath(entityType, entityId, type.ext);
  const absPath = absolutePath(relPath);
  if (!absPath) return null;

  // Ensure the prefix subdirectory exists
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(absPath, buffer);
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
  if (!absPath) {
    console.warn('Refusing to delete invalid image path');
    return;
  }
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
  if (!ENTITY_TYPES.includes(destEntityType) || !isValidEntityId(destEntityId)) return null;

  const srcAbs = absolutePath(sourceRelPath);
  if (!srcAbs || !fs.existsSync(srcAbs)) return null;

  // Extract extension from source path
  const ext = path.extname(sourceRelPath).replace('.', '') || 'webp';
  const destRelPath = relativePath(destEntityType, destEntityId, ext);
  const destAbs = absolutePath(destRelPath);
  if (!destAbs) return null;

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
  if (!absPath) return null;
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
