'use client';

import clsx from 'clsx';

export type StatusFilterValue = 'all' | 'active' | 'inactive';

const OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Disabled' },
];

export function StatusFilter({
  value,
  onChange,
}: {
  value: StatusFilterValue;
  onChange: (value: StatusFilterValue) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5 text-sm">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            'rounded px-3 py-1 transition-colors',
            value === option.value ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
