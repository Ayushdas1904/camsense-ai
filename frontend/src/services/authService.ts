import { apiClient } from './apiClient';
import type { ApiSuccess, AuthSession, User } from '@/types';

/**
 * Auth API surface. All auth-related HTTP lives here, not in components.
 */
export const authService = {
  async login(email: string, password: string): Promise<AuthSession> {
    const { data } = await apiClient.post<ApiSuccess<AuthSession>>('/auth/login', {
      email,
      password,
    });
    return data.data;
  },

  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },

  /**
   * Restores the session. Returns the user plus the narrowed asset token the
   * `/uploads` image mount requires — the session token is deliberately not
   * accepted there (see utils/assetUrl.ts).
   */
  async me(): Promise<{ user: User; assetToken?: string }> {
    const { data } = await apiClient.get<ApiSuccess<{ user: User; assetToken?: string }>>(
      '/auth/me'
    );
    return data.data;
  },
};
