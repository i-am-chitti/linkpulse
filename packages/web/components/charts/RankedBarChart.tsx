'use client';

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_INK, SEQUENTIAL_HUE } from '../../lib/chartPalette';

export interface RankedBarDatum {
  label: string;
  value: number;
}

/**
 * A ranked, single-hue horizontal bar chart: "compare magnitude" is a
 * sequential-color job, not a categorical one, even though each bar names a
 * different category (country, browser) - the reader is comparing bar
 * length, not distinguishing identity across a legend. Reused for both top
 * countries and browser breakdown so an open-ended, server-capped list (up
 * to 10 + "Other") never has to fit the categorical ladder's soft cap.
 *
 * Horizontal, not vertical columns: country and browser names vary enough in
 * length that vertical labels would collide or need rotation.
 */
export function RankedBarChart({ data }: { data: RankedBarDatum[] }) {
  // A little taller per row than Recharts' default so labels have room; caps
  // out so a 10-row list does not force an oddly tall chart.
  const height = Math.min(320, Math.max(120, data.length * 32));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 28, bottom: 4, left: 4 }}
        barCategoryGap={8}
      >
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          width={96}
          tick={{ fill: CHART_INK.secondary, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: CHART_INK.gridline, opacity: 0.5 }}
          formatter={(value) => [value, 'Clicks']}
          contentStyle={{
            borderRadius: 6,
            border: `1px solid ${CHART_INK.gridline}`,
            fontSize: 12,
          }}
        />
        <Bar dataKey="value" maxBarSize={20} radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={SEQUENTIAL_HUE} />
          ))}
          {/* Direct label past the bar end: country/browser names already
              occupy the axis, so there is no room to set the value inside. */}
          <LabelList
            dataKey="value"
            position="right"
            style={{ fill: CHART_INK.secondary, fontSize: 12 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
