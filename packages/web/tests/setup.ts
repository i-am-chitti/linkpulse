import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/**
 * @testing-library/react's own auto-cleanup relies on detecting a global
 * `afterEach` (Jest, or Vitest run with `globals: true`). This project keeps
 * `globals: false` and imports test functions explicitly everywhere else, so
 * that detection never fires - without this, a component rendered in one
 * test is still in the DOM for the next, and queries like getByLabelText
 * start matching multiple elements.
 */
afterEach(() => {
  cleanup();
});
