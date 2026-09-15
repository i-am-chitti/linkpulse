'use client';

import { Input } from './ui/Input';

export interface CreatedDateRange {
  from?: string;
  to?: string;
}

/** Today's date, in the browser's own time zone - a link's createdAt can never be in the future. */
function today(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

/**
 * The `max` attribute only blocks the browser's own date-picker UI - a
 * manually-typed date still fires onChange uncapped, so the cap has to be
 * enforced here too, not just declared on the input.
 */
function clampToToday(value: string, max: string): string | undefined {
  if (!value) return undefined;
  return value > max ? max : value;
}

export function CreatedDateFilter({
  value,
  onChange,
}: {
  value: CreatedDateRange;
  onChange: (value: CreatedDateRange) => void;
}) {
  const max = today();

  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label="Created after"
        value={value.from ?? ''}
        max={max}
        onChange={(e) => onChange({ ...value, from: clampToToday(e.target.value, max) })}
        className="w-38"
      />
      <span className="text-sm text-gray-400">to</span>
      <Input
        type="date"
        aria-label="Created before"
        value={value.to ?? ''}
        max={max}
        onChange={(e) => onChange({ ...value, to: clampToToday(e.target.value, max) })}
        className="w-38"
      />
    </div>
  );
}
