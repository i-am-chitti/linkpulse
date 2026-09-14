'use client';

import { useEffect, useState } from 'react';

/**
 * Delays reflecting a fast-changing value (a search input) until it has
 * stopped changing for `delayMs`, so a query fires once per pause in typing
 * rather than once per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
