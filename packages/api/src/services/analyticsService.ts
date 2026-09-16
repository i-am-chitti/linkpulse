/**
 * Click aggregation for the dashboard.
 *
 * Written as raw SQL rather than through the query builder for two reasons:
 * the aggregations here (generate_series gap filling, COUNT DISTINCT,
 * aggregate FILTER) have no ORM equivalent, and the SQL is the part worth
 * reading - it is where the clicks table's composite indexes earn their keep.
 *
 * Every COUNT is cast to int in SQL. Postgres COUNT returns bigint, which
 * Prisma surfaces as a JavaScript BigInt, and JSON.stringify throws on those -
 * so the cast is what keeps these values serialisable.
 */
import type {
  ClicksByDay,
  CountryClicks,
  DeviceType,
  LinkAnalytics,
  LinkAnalyticsSummary,
  ReferrerClicks,
} from '@linkpulse/shared';
import { TOP_BREAKDOWN_LIMIT } from '@linkpulse/shared';
import { prisma } from '../lib/prisma.js';

/** How a click with no resolved country, browser or OS is labelled. */
const UNKNOWN_LABEL = 'Unknown';
/** How a click with no referrer is labelled; null is its storage form. */
const DIRECT_LABEL = 'direct';

interface TotalsRow {
  total_clicks: number;
  unique_visitors: number;
}

/**
 * Total and distinct-visitor counts for the window.
 *
 * COUNT(DISTINCT ip_address) skips nulls, so periods older than the IP
 * retention window report fewer unique visitors than they truly had. That is
 * the accepted cost of not keeping addresses indefinitely, and it is why the
 * two numbers are reported separately rather than as a ratio.
 */
async function fetchTotals(linkId: string, from: string, to: string): Promise<TotalsRow> {
  const [row] = await prisma.$queryRaw<TotalsRow[]>`
    SELECT COUNT(*)::int                     AS total_clicks,
           COUNT(DISTINCT ip_address)::int   AS unique_visitors
      FROM clicks
     WHERE link_id = CAST(${linkId} AS uuid)
       AND click_date BETWEEN CAST(${from} AS date) AND CAST(${to} AS date)
  `;

  return row ?? { total_clicks: 0, unique_visitors: 0 };
}

/**
 * One row per day in the range, including days with no clicks.
 *
 * generate_series produces the calendar and the aggregate is LEFT JOINed onto
 * it, so a quiet day arrives as 0 rather than as a missing row. Filling the
 * gaps in application code instead would risk the API and the database
 * disagreeing about which days exist.
 */
async function fetchClicksByDay(linkId: string, from: string, to: string): Promise<ClicksByDay[]> {
  const rows = await prisma.$queryRaw<Array<{ date: Date; clicks: number }>>`
    SELECT calendar.day::date          AS date,
           COALESCE(counted.clicks, 0) AS clicks
      FROM generate_series(
             CAST(${from} AS date),
             CAST(${to} AS date),
             interval '1 day'
           ) AS calendar(day)
      LEFT JOIN (
             SELECT click_date, COUNT(*)::int AS clicks
               FROM clicks
              WHERE link_id = CAST(${linkId} AS uuid)
                AND click_date BETWEEN CAST(${from} AS date) AND CAST(${to} AS date)
              GROUP BY click_date
           ) AS counted ON counted.click_date = calendar.day::date
     ORDER BY calendar.day
  `;

  return rows.map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    clicks: row.clicks,
  }));
}

/**
 * Top countries.
 *
 * Ordered by count with the label as a tie-break, so equal counts come back in
 * a stable order instead of whatever the planner happens to emit.
 */
async function fetchTopCountries(
  linkId: string,
  from: string,
  to: string,
): Promise<CountryClicks[]> {
  return prisma.$queryRaw<CountryClicks[]>`
    SELECT COALESCE(country, ${UNKNOWN_LABEL}) AS country,
           COUNT(*)::int                       AS clicks
      FROM clicks
     WHERE link_id = CAST(${linkId} AS uuid)
       AND click_date BETWEEN CAST(${from} AS date) AND CAST(${to} AS date)
     GROUP BY 1
     ORDER BY clicks DESC, country ASC
     LIMIT ${TOP_BREAKDOWN_LIMIT}
  `;
}

/** Every device bucket, zero-filled, so the pie chart always has all slices. */
async function fetchDeviceBreakdown(
  linkId: string,
  from: string,
  to: string,
): Promise<Record<DeviceType, number>> {
  const rows = await prisma.$queryRaw<Array<{ device_type: string; clicks: number }>>`
    SELECT device_type, COUNT(*)::int AS clicks
      FROM clicks
     WHERE link_id = CAST(${linkId} AS uuid)
       AND click_date BETWEEN CAST(${from} AS date) AND CAST(${to} AS date)
     GROUP BY device_type
  `;

  const breakdown: Record<DeviceType, number> = {
    mobile: 0,
    desktop: 0,
    tablet: 0,
    unknown: 0,
  };

  for (const row of rows) {
    // The column is an uppercase Postgres enum; the API contract is lowercase.
    const key = row.device_type.toLowerCase() as DeviceType;
    if (key in breakdown) breakdown[key] = row.clicks;
  }

  return breakdown;
}

/**
 * Top browsers, with everything past the cut collapsed into "Other".
 *
 * The remainder is derived from the window total rather than by fetching every
 * browser, so the shares always add up even when the long tail is large.
 */
async function fetchBrowserBreakdown(
  linkId: string,
  from: string,
  to: string,
  totalClicks: number,
): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ browser: string; clicks: number }>>`
    SELECT COALESCE(browser, ${UNKNOWN_LABEL}) AS browser,
           COUNT(*)::int                       AS clicks
      FROM clicks
     WHERE link_id = CAST(${linkId} AS uuid)
       AND click_date BETWEEN CAST(${from} AS date) AND CAST(${to} AS date)
     GROUP BY 1
     ORDER BY clicks DESC, browser ASC
     LIMIT ${TOP_BREAKDOWN_LIMIT}
  `;

  const breakdown: Record<string, number> = {};
  let accounted = 0;
  for (const row of rows) {
    breakdown[row.browser] = row.clicks;
    accounted += row.clicks;
  }

  const remainder = totalClicks - accounted;
  if (remainder > 0) breakdown.Other = remainder;

  return breakdown;
}

/** Top referrers. A null referrer is reported as "direct". */
async function fetchTopReferrers(
  linkId: string,
  from: string,
  to: string,
): Promise<ReferrerClicks[]> {
  return prisma.$queryRaw<ReferrerClicks[]>`
    SELECT COALESCE(referrer, ${DIRECT_LABEL}) AS referrer,
           COUNT(*)::int                       AS clicks
      FROM clicks
     WHERE link_id = CAST(${linkId} AS uuid)
       AND click_date BETWEEN CAST(${from} AS date) AND CAST(${to} AS date)
     GROUP BY 1
     ORDER BY clicks DESC, referrer ASC
     LIMIT ${TOP_BREAKDOWN_LIMIT}
  `;
}

/**
 * The full analytics payload for one link over one window.
 *
 * The breakdowns are independent, so they run concurrently: the request costs
 * roughly the slowest query rather than the sum of six. Totals are awaited
 * first only because the browser "Other" bucket is derived from them.
 */
export async function getLinkAnalytics(
  linkId: string,
  range: { from: string; to: string },
): Promise<LinkAnalytics> {
  const { from, to } = range;
  const totals = await fetchTotals(linkId, from, to);

  const [clicksByDay, topCountries, deviceBreakdown, browserBreakdown, topReferrers] =
    await Promise.all([
      fetchClicksByDay(linkId, from, to),
      fetchTopCountries(linkId, from, to),
      fetchDeviceBreakdown(linkId, from, to),
      fetchBrowserBreakdown(linkId, from, to, totals.total_clicks),
      fetchTopReferrers(linkId, from, to),
    ]);

  return {
    linkId,
    period: { from, to },
    totalClicks: totals.total_clicks,
    uniqueVisitors: totals.unique_visitors,
    clicksByDay,
    topCountries,
    deviceBreakdown,
    browserBreakdown,
    topReferrers,
  };
}

interface SummaryRow {
  total_clicks: number;
  unique_visitors: number;
  clicks_last_7: number;
  clicks_last_30: number;
  last_clicked_at: Date | null;
}

/**
 * All-time headline numbers.
 *
 * Aggregate FILTER gets all four counts from a single pass over the link's
 * clicks, instead of one query per window.
 */
export async function getLinkAnalyticsSummary(linkId: string): Promise<LinkAnalyticsSummary> {
  const [totals] = await prisma.$queryRaw<SummaryRow[]>`
    SELECT COUNT(*)::int                                                        AS total_clicks,
           COUNT(DISTINCT ip_address)::int                                      AS unique_visitors,
           (COUNT(*) FILTER (WHERE click_date >= CURRENT_DATE - 6))::int        AS clicks_last_7,
           (COUNT(*) FILTER (WHERE click_date >= CURRENT_DATE - 29))::int       AS clicks_last_30,
           MAX(clicked_at)                                                      AS last_clicked_at
      FROM clicks
     WHERE link_id = CAST(${linkId} AS uuid)
  `;

  const [leaders] = await prisma.$queryRaw<
    Array<{ country: string | null; referrer: string | null; device: string | null }>
  >`
    SELECT (SELECT country FROM clicks
             WHERE link_id = CAST(${linkId} AS uuid) AND country IS NOT NULL
             GROUP BY country ORDER BY COUNT(*) DESC, country ASC LIMIT 1)  AS country,
           (SELECT COALESCE(referrer, ${DIRECT_LABEL}) FROM clicks
             WHERE link_id = CAST(${linkId} AS uuid)
             GROUP BY 1 ORDER BY COUNT(*) DESC, 1 ASC LIMIT 1)              AS referrer,
           (SELECT device_type::text FROM clicks
             WHERE link_id = CAST(${linkId} AS uuid)
             GROUP BY device_type ORDER BY COUNT(*) DESC, 1 ASC LIMIT 1)    AS device
  `;

  return {
    linkId,
    totalClicks: totals?.total_clicks ?? 0,
    uniqueVisitors: totals?.unique_visitors ?? 0,
    clicksLast7Days: totals?.clicks_last_7 ?? 0,
    clicksLast30Days: totals?.clicks_last_30 ?? 0,
    topCountry: leaders?.country ?? null,
    topReferrer: leaders?.referrer ?? null,
    topDevice: (leaders?.device?.toLowerCase() as DeviceType | undefined) ?? null,
    lastClickedAt: totals?.last_clicked_at?.toISOString() ?? null,
  };
}
