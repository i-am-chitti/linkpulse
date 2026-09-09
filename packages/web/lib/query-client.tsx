'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from './api';

export function QueryProvider({ children }: { children: ReactNode }) {
  // Constructed once per browser session via useState, not module scope: a
  // module-level client would be shared across requests in Next's dev/server
  // rendering path, leaking one user's cache into another's.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (failureCount, error) => {
              // A 401 means "not logged in" - apiFetch already tried a
              // refresh and failed, so retrying identically will not help.
              if (error instanceof ApiError && error.status === 401) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
