/**
 * Resolves a backend-relative asset path (e.g. a snapshot "/uploads/...") to an
 * absolute URL on the backend origin. Snapshots are served by the backend, not
 * the Vite dev server, so relative paths must be prefixed.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050/api';
const ORIGIN = API_BASE.replace(/\/api\/?$/, '');

export function assetUrl(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//.test(path)) return path;
  return `${ORIGIN}${path}`;
}
