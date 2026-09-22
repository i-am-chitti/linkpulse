'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { LoginInput, PublicUser, RegisterInput } from '@linkpulse/shared';
import { apiFetch, setAccessToken } from './api';

interface SessionResponse {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}

interface AuthContextValue {
  user: PublicUser | null;
  /** True while the initial session restore is in flight, on first load. */
  isLoading: boolean;
  login: (input: LoginInput, captchaToken?: string | null) => Promise<void>;
  register: (input: RegisterInput, captchaToken?: string | null) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    /**
     * Restores the session on a fresh load.
     *
     * The access token lives only in memory (see api.ts), so a reload always
     * starts with none. /api/auth/refresh reads the httpOnly cookie the
     * browser still holds and, if it is valid, returns a new access token -
     * apiFetch's own 401-retry path would work here too, but doing it once
     * explicitly means the dashboard is not left showing a flash of "logged
     * out" while the first real request quietly retries in the background.
     */
    let cancelled = false;

    apiFetch<SessionResponse>('/api/auth/refresh', { method: 'POST', skipAuthRetry: true })
      .then((session) => {
        if (cancelled) return;
        setAccessToken(session.accessToken);
        setUser(session.user);
      })
      .catch(() => {
        // No valid cookie, or the API is unreachable: proceed logged out.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function login(input: LoginInput, captchaToken?: string | null): Promise<void> {
    const session = await apiFetch<SessionResponse>('/api/auth/login', {
      method: 'POST',
      body: captchaToken ? { ...input, captchaToken } : input,
      skipAuthRetry: true,
    });
    setAccessToken(session.accessToken);
    setUser(session.user);
  }

  /**
   * captchaToken travels beside the input rather than inside it: it is a
   * transport concern the API strips before the register schema ever sees
   * it, not part of RegisterInput.
   */
  async function register(input: RegisterInput, captchaToken?: string | null): Promise<void> {
    const session = await apiFetch<SessionResponse>('/api/auth/register', {
      method: 'POST',
      body: captchaToken ? { ...input, captchaToken } : input,
      skipAuthRetry: true,
    });
    setAccessToken(session.accessToken);
    setUser(session.user);
  }

  async function logout(): Promise<void> {
    await apiFetch('/api/auth/logout', { method: 'POST', skipAuthRetry: true }).catch(() => {
      // Logout is idempotent server-side and the local session is cleared
      // below regardless, so a network failure here is not worth surfacing.
    });
    setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
