'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useLink } from '../../../../lib/links';
import { Card } from '../../../../components/ui/Card';

/**
 * Per-link analytics is the next chunk: charts for clicks over time, top
 * countries, device and browser breakdown, top referrers - all already
 * served by GET /api/links/:id/analytics. This confirms the route, the
 * dynamic param, and ownership resolve correctly ahead of that.
 */
export default function LinkAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const { data: link, isLoading, isError } = useLink(params.id);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your links
      </Link>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && (
        <p className="text-sm text-red-600">
          Couldn&apos;t load this link. It may not exist, or it may not be yours.
        </p>
      )}
      {link && (
        <Card>
          <h1 className="text-xl font-semibold text-gray-900">{link.shortCode}</h1>
          <p className="mt-1 truncate text-sm text-gray-600">{link.originalUrl}</p>
          <p className="mt-4 text-sm text-gray-500">
            {link.clickCount} clicks so far. Charts are coming in the next chunk.
          </p>
        </Card>
      )}
    </div>
  );
}
