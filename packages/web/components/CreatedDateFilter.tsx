'use client';

import { Input } from './ui/Input';

export interface CreatedDateRange {
  from?: string;
  to?: string;
}

export function CreatedDateFilter({
  value,
  onChange,
}: {
  value: CreatedDateRange;
  onChange: (value: CreatedDateRange) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label="Created after"
        value={value.from ?? ''}
        onChange={(e) => onChange({ ...value, from: e.target.value || undefined })}
        className="w-38"
      />
      <span className="text-sm text-gray-400">to</span>
      <Input
        type="date"
        aria-label="Created before"
        value={value.to ?? ''}
        onChange={(e) => onChange({ ...value, to: e.target.value || undefined })}
        className="w-38"
      />
    </div>
  );
}
