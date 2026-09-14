'use client';

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DeviceType } from '@linkpulse/shared';
import { CATEGORICAL, CHART_INK } from '../../lib/chartPalette';

const DEVICE_ORDER: DeviceType[] = ['mobile', 'desktop', 'tablet', 'unknown'];
const DEVICE_LABEL: Record<DeviceType, string> = {
  mobile: 'Mobile',
  desktop: 'Desktop',
  tablet: 'Tablet',
  unknown: 'Unknown',
};

/**
 * Part-to-whole of one total (every click, split by device): a single 100%
 * stacked horizontal bar in fixed categorical order, per the dataviz method's
 * "part-to-whole -> stacked bar, categorical color" rule. Four categories is
 * comfortable for the categorical ladder - no folding to "Other" needed.
 *
 * The legend row beneath doubles as the "relief" the palette validator
 * requires: two of the four slots (aqua, yellow) sit under 3:1 contrast on
 * this light surface, so identity is carried by the visible label, not color
 * alone.
 */
export function DeviceBreakdownChart({ breakdown }: { breakdown: Record<DeviceType, number> }) {
  const total = DEVICE_ORDER.reduce((sum, key) => sum + breakdown[key], 0);
  const row = { name: 'clicks', ...breakdown };

  return (
    <div>
      <ResponsiveContainer width="100%" height={56}>
        <BarChart data={[row]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" hide width={0} />
          <Tooltip
            cursor={{ fill: CHART_INK.gridline, opacity: 0.3 }}
            formatter={(value, key) => [value, DEVICE_LABEL[key as DeviceType]]}
            contentStyle={{
              borderRadius: 6,
              border: `1px solid ${CHART_INK.gridline}`,
              fontSize: 12,
            }}
          />
          {DEVICE_ORDER.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="devices"
              fill={CATEGORICAL[key]}
              // Rounded only on the two true ends of the whole stack, not on
              // every internal segment boundary - a 2px surface gap between
              // segments (via the bar's own stroke) keeps them visually
              // separated without looking like four independent bars.
              radius={
                index === 0 ? [4, 0, 0, 4] : index === DEVICE_ORDER.length - 1 ? [0, 4, 4, 0] : 0
              }
              stroke={CHART_INK.surface}
              strokeWidth={2}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {DEVICE_ORDER.map((key) => {
          const value = breakdown[key];
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <div key={key} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: CATEGORICAL[key] }}
                aria-hidden
              />
              <span>
                {DEVICE_LABEL[key]} · {value} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
