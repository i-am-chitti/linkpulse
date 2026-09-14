'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useLinkAnalytics, useLinkAnalyticsSummary } from '../../../../lib/analytics';
import { useLink } from '../../../../lib/links';
import { DateRangePicker, rangeForDays } from '../../../../components/DateRangePicker';
import { ClicksOverTimeChart } from '../../../../components/charts/ClicksOverTimeChart';
import { DeviceBreakdownChart } from '../../../../components/charts/DeviceBreakdownChart';
import { RankedBarChart } from '../../../../components/charts/RankedBarChart';
import { StatTile } from '../../../../components/charts/StatTile';
import { TopReferrersTable } from '../../../../components/charts/TopReferrersTable';
import { Card } from '../../../../components/ui/Card';

function formatInstant(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function LinkAnalyticsPage() {
  const params = useParams<{ id: string }>();
  const [days, setDays] = useState(30);
  const range = rangeForDays(days);

  const { data: link, isLoading: linkLoading, isError: linkError } = useLink(params.id);
  const { data: summary } = useLinkAnalyticsSummary(params.id);
  const { data: analytics, isLoading: analyticsLoading } = useLinkAnalytics(params.id, range);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your links
      </Link>

      {linkLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {linkError && (
        <p className="text-sm text-red-600">
          Couldn&apos;t load this link. It may not exist, or it may not be yours.
        </p>
      )}

      {link && (
        <>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{link.shortCode}</h1>
            <p className="mt-1 truncate text-sm text-gray-600">{link.originalUrl}</p>
          </div>

          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Total clicks" value={summary.totalClicks} />
              <StatTile label="Unique visitors" value={summary.uniqueVisitors} />
              <StatTile label="Last 7 days" value={summary.clicksLast7Days} />
              <StatTile label="Last 30 days" value={summary.clicksLast30Days} />
              <StatTile
                label="Top country"
                value={summary.topCountry ?? '—'}
                title={summary.topCountry ?? undefined}
              />
              <StatTile
                label="Top referrer"
                value={summary.topReferrer ?? '—'}
                title={summary.topReferrer ?? undefined}
              />
              <StatTile label="Top device" value={summary.topDevice ?? '—'} />
              <StatTile label="Last click" value={formatInstant(summary.lastClickedAt)} />
            </div>
          )}

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Clicks over time</h2>
              <DateRangePicker activeDays={days} onSelect={setDays} />
            </div>
            {analyticsLoading && (
              <p className="py-10 text-center text-sm text-gray-500">Loading…</p>
            )}
            {analytics && <ClicksOverTimeChart data={analytics.clicksByDay} />}
          </Card>

          {analytics && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <h2 className="mb-3 text-sm font-medium text-gray-700">Top countries</h2>
                {analytics.topCountries.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">No data in this window.</p>
                ) : (
                  <RankedBarChart
                    data={analytics.topCountries.map((c) => ({
                      label: c.country,
                      value: c.clicks,
                    }))}
                  />
                )}
              </Card>

              <Card>
                <h2 className="mb-3 text-sm font-medium text-gray-700">Browsers</h2>
                {Object.keys(analytics.browserBreakdown).length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">No data in this window.</p>
                ) : (
                  <RankedBarChart
                    data={Object.entries(analytics.browserBreakdown)
                      .map(([label, value]) => ({ label, value }))
                      .sort((a, b) => b.value - a.value)}
                  />
                )}
              </Card>

              <Card>
                <h2 className="mb-3 text-sm font-medium text-gray-700">Devices</h2>
                <DeviceBreakdownChart breakdown={analytics.deviceBreakdown} />
              </Card>

              <Card>
                <h2 className="mb-3 text-sm font-medium text-gray-700">Top referrers</h2>
                <TopReferrersTable referrers={analytics.topReferrers} />
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
