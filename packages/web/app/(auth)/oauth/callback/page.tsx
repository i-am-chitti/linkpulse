'use client';

import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../lib/auth';
import { Card } from '../../../../components/ui/Card';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state: 'That sign-in request expired or was invalid. Please try again.',
  missing_code: 'The provider did not return an authorization code. Please try again.',
  provider_not_configured: "This sign-in method isn't set up on this server.",
  email_taken:
    'An account with this email already exists. Sign in with your original method instead.',
  oauth_failed: 'Something went wrong signing you in.',
};

/**
 * No token in the URL: the API's oauth callback only ever sets the httpOnly
 * refresh cookie and redirects here with nothing but an optional `error`.
 * AuthProvider's own mount effect (see lib/auth.tsx) already calls
 * /api/auth/refresh on every page load and reads that cookie - the same
 * mechanism a normal reload uses to restore a session - so this page's only
 * job on success is to wait for that to resolve, then leave.
 */
function CallbackContent() {
  const searchParams = useSearchParams();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const errorCode = searchParams.get('error');

  useEffect(() => {
    if (errorCode || isLoading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [errorCode, isLoading, user, router]);

  if (errorCode) {
    const message = ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.oauth_failed;
    return (
      <Card>
        <p className="text-sm text-red-600">{message}</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-brand hover:underline">
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm text-gray-500">Signing you in…</p>
    </Card>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <p className="text-sm text-gray-500">Signing you in…</p>
        </Card>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
