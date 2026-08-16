/**
 * Thin wrapper over localStorage for the auth token, isolated here so the
 * storage mechanism can change (e.g. to httpOnly cookies) without touching
 * the rest of the app.
 */
const TOKEN_KEY = 'camsense.token';

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
