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

  async me(): Promise<User> {
    const { data } = await apiClient.get<ApiSuccess<{ user: User }>>('/auth/me');
    return data.data.user;
  },
};
