import type { ReferrerClicks } from '@linkpulse/shared';

/**
 * A table, not a chart. Referrer names are the point (twitter.com vs
 * news.ycombinator.com vs direct), and per the dataviz method a list where
 * the identity of each row matters more than a bar comparing it to the next
 * is exactly the "not a chart" case.
 */
export function TopReferrersTable({ referrers }: { referrers: ReferrerClicks[] }) {
  if (referrers.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-500">No referrers in this window.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
          <th className="py-2 font-medium">Referrer</th>
          <th className="py-2 text-right font-medium">Clicks</th>
        </tr>
      </thead>
      <tbody>
        {referrers.map((row) => (
          <tr key={row.referrer} className="border-b border-gray-100 last:border-0">
            <td className="py-2 text-gray-700">{row.referrer}</td>
            <td className="py-2 text-right tabular-nums text-gray-900">{row.clicks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
