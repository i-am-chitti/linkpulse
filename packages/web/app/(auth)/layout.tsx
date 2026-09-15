import Link from 'next/link';
import { Link2 } from 'lucide-react';
import type { ReactNode } from 'react';

/** Centers the login/register card; neither page needs the dashboard shell. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-50 px-4">
      <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-gray-900">
        <Link2 className="h-5 w-5 text-brand" />
        LinkPulse
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
