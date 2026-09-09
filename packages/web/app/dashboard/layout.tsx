'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui/Button';

/**
 * Client-side route protection.
 *
 * A server-side redirect would need the access token available on the
 * server, but it deliberately lives only in the browser's memory (see
 * api.ts) - so the guard has to run here, after the session-restore effect
 * in AuthProvider has had a chance to resolve.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">Loading…</div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-gray-900">
            <Link2 className="h-5 w-5 text-brand" />
            LinkPulse
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">{user.email}</span>
            <Button variant="ghost" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
