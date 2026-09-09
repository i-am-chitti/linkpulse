'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '../lib/auth';
import { QueryProvider } from '../lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthProvider>{children}</AuthProvider>
    </QueryProvider>
  );
}
