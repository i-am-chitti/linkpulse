'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { GuestShortenForm } from '../components/GuestShortenForm';
import { Card } from '../components/ui/Card';

/**
 * A signed-in visitor has nothing to do here - straight to their dashboard.
 * A signed-out one gets PROJECT_SPEC.md section 2.1's guest mode: shorten a
 * link with no account, right here, or sign in for saved links and analytics.
 */
export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user) router.replace('/dashboard');
  }, [isLoading, user, router]);

  if (isLoading || user) return null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-gray-900">LinkPulse</h1>
        <p className="mt-1 text-gray-600">Shorten a link in seconds. No account required.</p>
      </div>
      <Card className="w-full max-w-md">
        <GuestShortenForm />
      </Card>
      <p className="text-sm text-gray-500">
        <Link href="/login" className="text-brand hover:underline">
          Sign in
        </Link>{' '}
        for saved links, custom aliases, and analytics.
      </p>
    </div>
  );
}
