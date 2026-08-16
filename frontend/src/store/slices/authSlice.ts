import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { authService } from '@/services/authService';
import { tokenStorage } from '@/utils/storage';
import type { User } from '@/types';

/**
 * Auth is genuinely global state (needed by routing, the topbar, and guards),
 * so it lives in Redux Toolkit. Feature-local state stays in components.
 */
interface AuthState {
  user: User | null;
  token: string | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
  error: string | null;
  // True until the initial "restore session from token" check completes,
  // so the app doesn't flash the login page for an already-authed user.
  initializing: boolean;
}

const initialState: AuthState = {
  user: null,
  token: tokenStorage.get(),
  status: 'idle',
  error: null,
  initializing: true,
};

export const login = createAsyncThunk<
  { user: User; token: string },
  { email: string; password: string },
  { rejectValue: string }
>('auth/login', async ({ email, password }, { rejectWithValue }) => {
  try {
    const session = await authService.login(email, password);
    tokenStorage.set(session.token);
    return session;
  } catch (err) {
    return rejectWithValue((err as { message?: string }).message || 'Login failed');
  }
});

/** Restores the user from a stored token on app boot. */
export const restoreSession = createAsyncThunk<User | null>(
  'auth/restore',
  async () => {
    if (!tokenStorage.get()) return null;
    try {
      return await authService.me();
    } catch {
      tokenStorage.clear();
      return null;
    }
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      state.user = null;
      state.token = null;
      state.status = 'idle';
      tokenStorage.clear();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<{ user: User; token: string }>) => {
        state.status = 'authenticated';
        state.user = action.payload.user;
        state.token = action.payload.token;
      })
      .addCase(login.rejected, (state, action) => {
        state.status = 'error';
        state.error = action.payload || 'Login failed';
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.initializing = false;
        if (action.payload) {
          state.user = action.payload;
          state.status = 'authenticated';
        }
      })
      .addCase(restoreSession.rejected, (state) => {
        state.initializing = false;
      });
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
