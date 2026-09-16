'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ClicksByDay } from '@linkpulse/shared';
import { CHART_INK, SEQUENTIAL_HUE } from '../../lib/chartPalette';

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Trend over time, single series: a line chart in the one sequential hue.
 * No legend - a single series needs none, the axis and tooltip carry it.
 */
export function ClicksOverTimeChart({ data }: { data: ClicksByDay[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 44, bottom: 0, left: -12 }}>
        {/* Recessive gridlines: horizontal only, hairline, never competing with the data. */}
        <CartesianGrid stroke={CHART_INK.gridline} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatShortDate}
          tick={{ fill: CHART_INK.muted, fontSize: 12 }}
          axisLine={{ stroke: CHART_INK.axis }}
          tickLine={false}
          minTickGap={24}
          // Recharts can otherwise drop the last label for space while still
          // plotting its point; preserveStartEnd always keeps first/last ticks.
          interval="preserveStartEnd"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: CHART_INK.muted, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={32}
        />
        {/* The hover layer the method calls for by default on a line chart -
            a crosshair-adjacent tooltip, not decoration. */}
        <Tooltip
          cursor={{ stroke: CHART_INK.axis, strokeDasharray: '3 3' }}
          formatter={(value) => [value, 'Clicks']}
          labelFormatter={(label) => (typeof label === 'string' ? formatShortDate(label) : label)}
          contentStyle={{
            borderRadius: 6,
            border: `1px solid ${CHART_INK.gridline}`,
            fontSize: 12,
          }}
        />
        <Line
          type="monotone"
          dataKey="clicks"
          stroke={SEQUENTIAL_HUE}
          strokeWidth={2}
          dot={data.length <= 31}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
