'use client';

import clsx from 'clsx';

export interface DateRange {
  from: string;
  to: string;
}

interface Preset {
  label: string;
  days: number;
}

const PRESETS: Preset[] = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function rangeForDays(days: number): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: isoDate(from), to: isoDate(to) };
}

/**
 * Preset date-range rows, per the dataviz method's filter guidance - a short
 * list of common ranges rather than a full calendar picker, which is more
 * control than this dashboard needs. Selection is highlighted by matching
 * the currently active day-count, not by remembering which button was
 * clicked, so the row stays correct if the range ever arrives some other way.
 */
export function DateRangePicker({
  activeDays,
  onSelect,
}: {
  activeDays: number;
  onSelect: (days: number) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-sm">
      {PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          onClick={() => onSelect(preset.days)}
          className={clsx(
            'rounded px-3 py-1 transition-colors',
            activeDays === preset.days ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}
