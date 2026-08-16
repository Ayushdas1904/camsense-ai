import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Persists a detection snapshot to local disk and returns a public URL path.
 *
 * Design (per spec §19): the alert references the snapshot by URL — the large
 * image is NOT embedded in the MongoDB document. The storage backend is
 * isolated here so it can later be swapped for S3/Cloudinary without touching
 * callers: only this function changes.
 */
export async function saveSnapshot(dataUrl, cameraId) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!match) return null;

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');

  // Stamp filenames with a counter+random suffix (no Date.now dependency issues).
  const safeCamera = String(cameraId || 'cam').replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `${safeCamera}_${Date.now()}_${Math.round(Math.random() * 1e6)}.${ext}`;

  try {
    await fs.mkdir(env.snapshotDir, { recursive: true });
    await fs.writeFile(path.join(env.snapshotDir, filename), buffer);
    // Served by the static /uploads mount (see app.js).
    return `/uploads/snapshots/${filename}`;
  } catch (err) {
    logger.error('Failed to save snapshot', err.message);
    return null;
  }
}
