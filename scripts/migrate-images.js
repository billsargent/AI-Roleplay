#!/usr/bin/env node

/**
 * --- One-Time Migration: Base64 -> File-System Image Storage ---
 *
 * This script migrates all existing base64 image/avatar data from the
 * SQLite database to the file system. After extraction, the base64 data
 * is cleared from the TEXT columns to shrink the database.
 *
 * Tables migrated:
 *   scenarios.image       -> uploads/scenarios/{prefix}/{id}.{ext}
 *   characters.avatar     -> uploads/characters/{prefix}/{id}.{ext}
 *   personas.avatar       -> uploads/personas/{prefix}/{id}.{ext}
 *   scenarios.introduction (embedded <img> tags) -> uploads/embedded/{id}.{ext}
 *
 * (lore_pieces did not have a base64 avatar column, so no migration needed.)
 *
 * Usage:
 *   node scripts/migrate-images.js
 *
 * Optional: dry-run to preview without changing the database or writing files:
 *   node scripts/migrate-images.js --dry-run
 *
 * A live run first writes a backup copy of the database next to it
 * ("<database file>.backup-<timestamp>").
 *
 * Rows that already have a file path but still carry the old base64 copy
 * (the app used to write both) have the base64 copy cleared.
 */

import crypto from 'crypto';
import { getDb } from '../database/index.js';
import { saveImage, ensureUploadsDirs, parseDataUrl, relativePath } from '../database/images.js';
import { sniffImageType } from '../lib/imageType.js';

/**
 * Saves (or, in a dry run, only checks) a base64 image.
 * @returns {{ relPath: string|null, err?: string }}
 */
function trySaveImage(dataUrl, entityType, entityId, dryRun) {
  try {
    if (dryRun) {
      const parsed = parseDataUrl(dataUrl);
      const type = parsed && sniffImageType(Buffer.from(parsed.base64, 'base64'));
      if (!type) return { relPath: null, err: 'not a supported image' };
      return { relPath: relativePath(entityType, entityId, type.ext) };
    }
    const relPath = saveImage(dataUrl, entityType, entityId);
    return relPath ? { relPath } : { relPath: null, err: 'not a supported image (or too large)' };
  } catch (err) {
    return { relPath: null, err: err.message || String(err) };
  }
}

async function runMigration(dryRun) {
  console.log('');
  console.log('='.repeat(67));
  console.log('  Image Migration: Base64 -> File System');
  console.log('  Mode: ' + (dryRun ? 'DRY RUN (no changes made)' : 'LIVE'));
  console.log('='.repeat(67));
  console.log('');

  ensureUploadsDirs();
  const db = getDb();

  if (!dryRun) {
    const backup = `${db.name}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await db.backup(backup);
    console.log('Backup written: ' + backup);
    console.log('');
  }

  const stats = {
    scenarios: 0,
    characters: 0,
    personas: 0,
    lorePieces: 0,
    embeddedIntros: 0,
    embeddedImages: 0,
    skippedNoBase64: 0,
    alreadyMigrated: 0,
    clearedLeftovers: 0,
    errors: [],
  };

  // --- 1. Scenarios ---
  console.log('--- Scenarios ---');
  const scenarios = db.prepare("SELECT id, image, image_path FROM scenarios WHERE image != ''").all();
  for (const s of scenarios) {
    if (s.image_path) {
      if (s.image.startsWith('data:image/')) {
        // File already exists; drop the leftover base64 copy
        if (!dryRun) db.prepare("UPDATE scenarios SET image = '' WHERE id = ?").run(s.id);
        stats.clearedLeftovers++;
        console.log('  CLEAR ' + s.id + ' - has image_path, removing leftover base64');
      } else {
        stats.alreadyMigrated++;
      }
      continue;
    }
    if (!s.image.startsWith('data:image/')) {
      stats.skippedNoBase64++;
      console.log('  SKIP ' + s.id + ' - not base64 (URL or empty)');
      continue;
    }
    const result = trySaveImage(s.image, 'scenarios', s.id, dryRun);
    if (result.err) {
      stats.errors.push('Scenario ' + s.id + ': ' + result.err);
      console.error('  FAIL ' + s.id + ' - ' + result.err);
      continue;
    }
    if (result.relPath) {
      if (!dryRun) {
        db.prepare("UPDATE scenarios SET image_path = ?, image = '' WHERE id = ?").run(result.relPath, s.id);
      }
      stats.scenarios++;
      console.log('  OK ' + s.id + ' -> ' + result.relPath);
    }
  }
  console.log('');

  // --- 2. Characters ---
  console.log('--- Characters ---');
  const characters = db.prepare("SELECT id, avatar, avatar_path FROM characters WHERE avatar != ''").all();
  for (const c of characters) {
    if (c.avatar_path) {
      if (c.avatar.startsWith('data:image/')) {
        // File already exists; drop the leftover base64 copy
        if (!dryRun) db.prepare("UPDATE characters SET avatar = '' WHERE id = ?").run(c.id);
        stats.clearedLeftovers++;
        console.log('  CLEAR ' + c.id + ' - has avatar_path, removing leftover base64');
      } else {
        stats.alreadyMigrated++;
      }
      continue;
    }
    if (!c.avatar.startsWith('data:image/')) {
      stats.skippedNoBase64++;
      console.log('  SKIP ' + c.id + ' - not base64');
      continue;
    }
    const result = trySaveImage(c.avatar, 'characters', c.id, dryRun);
    if (result.err) {
      stats.errors.push('Character ' + c.id + ': ' + result.err);
      console.error('  FAIL ' + c.id + ' - ' + result.err);
      continue;
    }
    if (result.relPath) {
      if (!dryRun) {
        db.prepare("UPDATE characters SET avatar_path = ?, avatar = '' WHERE id = ?").run(result.relPath, c.id);
      }
      stats.characters++;
      console.log('  OK ' + c.id + ' -> ' + result.relPath);
    }
  }
  console.log('');

  // --- 3. Personas ---
  console.log('--- Personas ---');
  const personas = db.prepare("SELECT id, avatar, avatar_path FROM personas WHERE avatar != ''").all();
  for (const p of personas) {
    if (p.avatar_path) {
      if (p.avatar.startsWith('data:image/')) {
        // File already exists; drop the leftover base64 copy
        if (!dryRun) db.prepare("UPDATE personas SET avatar = '' WHERE id = ?").run(p.id);
        stats.clearedLeftovers++;
        console.log('  CLEAR ' + p.id + ' - has avatar_path, removing leftover base64');
      } else {
        stats.alreadyMigrated++;
      }
      continue;
    }
    if (!p.avatar.startsWith('data:image/')) {
      stats.skippedNoBase64++;
      console.log('  SKIP ' + p.id + ' - not base64');
      continue;
    }
    const result = trySaveImage(p.avatar, 'personas', p.id, dryRun);
    if (result.err) {
      stats.errors.push('Persona ' + p.id + ': ' + result.err);
      console.error('  FAIL ' + p.id + ' - ' + result.err);
      continue;
    }
    if (result.relPath) {
      if (!dryRun) {
        db.prepare("UPDATE personas SET avatar_path = ?, avatar = '' WHERE id = ?").run(result.relPath, p.id);
      }
      stats.personas++;
      console.log('  OK ' + p.id + ' -> ' + result.relPath);
    }
  }
  console.log('');

  // --- 4. Lore Pieces (skip - no base64 column) ---
  const loreCount = db.prepare("SELECT COUNT(*) as cnt FROM lore_pieces WHERE avatar_path != ''").get();
  stats.lorePieces = loreCount.cnt;
  if (loreCount.cnt > 0) {
    console.log('--- Lore Pieces (already migrated) ---');
    console.log('  ' + loreCount.cnt + ' lore pieces already have avatar_path set.');
    console.log('');
  }

  // --- 5. Introduction Embedded Images ---
  console.log('--- Introduction Embedded Images ---');
  const introRows = db.prepare("SELECT id, introduction FROM scenarios WHERE introduction LIKE '%data:image/%'").all();

  for (const s of introRows) {
    let html = s.introduction;
    let changed = false;
    let imgCount = 0;

    const regex = /<img[^>]*src="(data:image\/[^"]+)"/gi;
    html = html.replace(regex, function(match, dataUrl) {
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return match;

      const hash = crypto.createHash('md5').update(dataUrl).digest('hex');
      const eid = s.id.substring(0, 14) + '_' + hash.substring(0, 12);

      const r2 = trySaveImage(dataUrl, 'embedded', eid, dryRun);
      if (r2.err) {
        stats.errors.push('Intro ' + s.id + '/' + eid + ': ' + r2.err);
        console.error('  FAIL ' + s.id + '/' + eid + ' - ' + r2.err);
        return match;
      }

      stats.embeddedImages++;
      imgCount++;
      changed = true;
      return match.replace(dataUrl, '/api/images/' + r2.relPath);
    });

    if (changed) {
      if (!dryRun) {
        db.prepare("UPDATE scenarios SET introduction = ? WHERE id = ?").run(html, s.id);
        console.log('  OK ' + s.id + ' - ' + imgCount + ' embedded image(s)');
      } else {
        console.log('  DRY ' + s.id + ' - would replace ' + imgCount + ' embedded image(s)');
      }
      stats.embeddedIntros++;
    }
  }

  if (introRows.length === 0) {
    console.log('  No embedded images in introductions.');
  }
  console.log('');

  // --- Summary ---
  console.log('='.repeat(67));
  console.log('  Migration Summary');
  console.log('='.repeat(67));
  console.log('  Scenarios:          ' + stats.scenarios + ' migrated');
  console.log('  Characters:         ' + stats.characters + ' migrated');
  console.log('  Personas:           ' + stats.personas + ' migrated');
  console.log('  Lore pieces:        ' + stats.lorePieces + ' have paths');
  console.log('  Intros processed:   ' + stats.embeddedIntros);
  console.log('  Embedded images:    ' + stats.embeddedImages + ' extracted');
  console.log('  Already had paths:  ' + stats.alreadyMigrated);
  console.log('  Leftovers cleared:  ' + stats.clearedLeftovers);
  console.log('  Skipped (not b64):  ' + stats.skippedNoBase64);
  console.log('  Errors:             ' + stats.errors.length);
  if (stats.errors.length > 0) {
    for (const e of stats.errors) console.log('    - ' + e);
  }
  console.log('='.repeat(67));
  if (dryRun) {
    console.log('');
    console.log('  Dry run. No changes made.');
    console.log('  Run without --dry-run to execute.');
  } else {
    console.log('');
    console.log('  Done. Base64 cleared from database.');
    console.log('  Run VACUUM (or let SQLite reuse the space) to shrink the file.');
  }
  console.log('');
}

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run') || args.includes('-n');

runMigration(isDryRun).catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
