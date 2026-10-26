'use client';

import { create } from 'zustand';
import { api, clearAuthCache, getToken } from '@/lib/request';
import type { User } from '@/types/api';

interface AuthState {
  token: string | null;
  user: User | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  loading: true,

  hydrate: async () => {
    const token = getToken();
    if (!token) {
      set({ token: null, user: null, loading: false });
      return;
    }
    try {
      const { user } = await api.get<{ user: User }>('/auth/profile', { cacheMs: 0 });
      set({ token, user, loading: false });
    } catch {
      clearAuthCache();
      set({ token: null, user: null, loading: false });
    }
  },

  setAuth: (token, user) => {
    localStorage.setItem('zxh_token', token);
    set({ token, user, loading: false });
  },

  logout: () => {
    clearAuthCache();
    set({ token: null, user: null });
    window.location.href = '/login';
  },
}));
