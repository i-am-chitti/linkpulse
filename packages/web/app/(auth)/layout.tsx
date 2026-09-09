import type { ReactNode } from 'react';

/** Centers the login/register card; neither page needs the dashboard shell. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
