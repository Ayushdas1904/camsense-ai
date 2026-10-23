/**
 * Thin wrapper over localStorage for the auth credentials, isolated here so the
 * storage mechanism can change (e.g. to httpOnly cookies) without touching
 * the rest of the app.
 *
 * Two separate credentials, deliberately:
 *   • the SESSION token, sent as an Authorization header on API calls;
 *   • the ASSET token, a narrowed credential the backend mints for `/uploads`
 *     image URLs only. An <img> tag cannot send a header, so that one ends up
 *     in a URL — and therefore in browser history and any fronting proxy's
 *     log. Keeping it separate means what leaks there buys image reads for a
 *     shorter window, not the whole API for the session's lifetime.
 */
const TOKEN_KEY = 'camsense.token';
const ASSET_TOKEN_KEY = 'camsense.assetToken';

export const tokenStorage = {
  get(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
  },
};

export const assetTokenStorage = {
  get(): string | null {
    return localStorage.getItem(ASSET_TOKEN_KEY);
  },
  set(token: string | null | undefined): void {
    if (token) localStorage.setItem(ASSET_TOKEN_KEY, token);
  },
  clear(): void {
    localStorage.removeItem(ASSET_TOKEN_KEY);
  },
};
