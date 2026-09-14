import type { ReactNode } from 'react';

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: string;
  /**
   * Full value for the native tooltip on hover/focus, when `value` is a
   * string that might overflow the tile - a referrer domain or country name
   * can run longer than a tile is wide, unlike the numeric tiles.
   */
  title?: string;
}

/**
 * A single headline number, not a chart - per the dataviz method, "a single
 * current value" is a stat tile, not a one-bar bar chart. Tabular figures are
 * reserved for values that must align in a column (tables, axis ticks); a
 * lone stat-tile value stays proportional, per the skill's typography guidance.
 */
export function StatTile({ label, value, hint, title }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-4">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="truncate text-xl font-semibold text-gray-900" title={title}>
        {value}
      </span>
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </div>
  );
}
