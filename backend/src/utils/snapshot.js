import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Persists an image to local disk and returns a public URL path.
 *
 * Design (per spec §19/§23): the alert, recognition event, or person record
 * references the image by URL — the large image is NOT embedded in the MongoDB
 * document. The storage backend is isolated here so it can later be swapped
 * for S3/Cloudinary without touching callers: only this module changes.
 *
 * Review 2 added the optional `subdir` option (used for registration
 * photographs, written under uploads/snapshots/people/) and `removeStoredImage`
 * so a hard-deleted person's photograph is not retained indefinitely. It is a
 * deliberate extension of this single storage layer rather than a second
 * implementation.
 */

// webp was added for Review 2 registration photographs.
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Validates a base64 image data URL and decodes it.
 * Returns null (never throws) when the input is not an accepted image data URL.
 */
export function parseImageDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;

  const match = dataUrl.match(DATA_URL_PATTERN);
  if (!match) return null;

  const declared = match[1];
  const ext = declared === 'jpeg' ? 'jpg' : declared;
  return {
    ext,
    mime: `image/${declared}`,
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64'),
  };
}

/** Strips anything that could escape the snapshot directory. */
function safeSegment(value, fallback) {
  const cleaned = String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || fallback;
}

export async function saveSnapshot(dataUrl, cameraId, { subdir = '' } = {}) {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;

  const safeCamera = safeSegment(cameraId, 'cam');
  const safeSubdir = subdir ? safeSegment(subdir, '') : '';
  const targetDir = safeSubdir ? path.join(env.snapshotDir, safeSubdir) : env.snapshotDir;

  // Stamp filenames with a timestamp+random suffix so concurrent writes for the
  // same camera cannot collide.
  const filename = `${safeCamera}_${Date.now()}_${Math.round(Math.random() * 1e6)}.${parsed.ext}`;

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, filename), parsed.buffer);
    // Served by the static /uploads mount (see app.js).
    return safeSubdir
      ? `/uploads/snapshots/${safeSubdir}/${filename}`
      : `/uploads/snapshots/${filename}`;
  } catch (err) {
    logger.error('Failed to save snapshot', err.message);
    return null;
  }
}

/**
 * Deletes a previously stored image given the URL path saveSnapshot returned.
 *
 * Refuses anything that is not inside the snapshot directory, so a crafted
 * value on a person record cannot be used to unlink an arbitrary file.
 * Returns true only when a file was actually removed.
 */
export async function removeStoredImage(urlPath) {
  const prefix = '/uploads/snapshots/';
  if (!urlPath || typeof urlPath !== 'string' || !urlPath.startsWith(prefix)) return false;

  const relative = urlPath.slice(prefix.length);
  if (!relative || relative.includes('..')) return false;

  const root = path.resolve(env.snapshotDir);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) return false;

  try {
    await fs.unlink(target);
    return true;
  } catch (err) {
    // Already gone, or never written — not an error worth failing a request for.
    logger.warn(`Could not remove stored image ${urlPath}: ${err.message}`);
    return false;
  }
}
