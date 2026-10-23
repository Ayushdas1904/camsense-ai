/**
 * Resolves a backend-relative asset path (e.g. a snapshot "/uploads/...") to an
 * absolute URL on the backend origin. Snapshots are served by the backend, not
 * the Vite dev server, so relative paths must be prefixed.
 *
 * The backend's /uploads mount is AUTHENTICATED: it serves detection snapshots,
 * cropped face snapshots from unknown-identity events, and enrolled people's
 * registration portraits, none of which may be anonymously fetchable. An <img>
 * tag cannot send an Authorization header, so a credential has to travel in the
 * URL — where it lands in browser history, devtools, and any proxy in front of
 * the backend.
 *
 * So the credential used here is NOT the session token. It is the narrowed
 * `assetToken` the backend mints alongside the session (scoped to the /uploads
 * mount, shorter-lived, no role, no write access); the backend REJECTS a full
 * session token in this query parameter for exactly that reason. The token is
 * delivered by login and by GET /api/auth/me, so it is already in storage
 * before any page that renders an image.
 *
 * If no asset token is stored (an expired one is cleared, or the session was
 * restored against an older backend), the plain URL is returned and the image
 * request gets a 401 — a broken thumbnail, never an unauthenticated read.
 */
import { assetTokenStorage } from '@/utils/storage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050/api';
const ORIGIN = API_BASE.replace(/\/api\/?$/, '');

export function assetUrl(path?: string): string | undefined {
  if (!path) return undefined;
  // An absolute URL is someone else's asset (or already signed); leave it alone.
  if (/^https?:\/\//.test(path)) return path;

  const token = assetTokenStorage.get();
  if (!token) return `${ORIGIN}${path}`;
  const separator = path.includes('?') ? '&' : '?';
  return `${ORIGIN}${path}${separator}token=${encodeURIComponent(token)}`;
}
