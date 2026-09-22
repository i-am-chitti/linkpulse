// NEXT_PUBLIC_TURNSTILE_SITE_KEY is read once at module load (lib/env.ts),
// so it must be stubbed before the dynamic import below. The unset case
// needs its own file: vitest isolates module registries per file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-site-key');

const { CaptchaField, captchaRequired } = await import('../components/CaptchaField');

interface RenderOptions {
  sitekey: string;
  appearance: string;
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

let lastOptions: RenderOptions | undefined;
const remove = vi.fn();

beforeEach(() => {
  lastOptions = undefined;
  // loadTurnstile() short-circuits on an existing window.turnstile, so the
  // real script is never fetched.
  window.turnstile = {
    render: (_container, options) => {
      lastOptions = options as RenderOptions;
      return 'widget-1';
    },
    remove,
  };
});

afterEach(() => {
  delete window.turnstile;
  vi.restoreAllMocks();
});

describe('CaptchaField, with a site key', () => {
  it('marks the captcha as required for forms to gate on', () => {
    expect(captchaRequired).toBe(true);
  });

  it('renders the widget with the configured site key', async () => {
    render(<CaptchaField onToken={vi.fn()} />);

    await waitFor(() => expect(lastOptions?.sitekey).toBe('test-site-key'));
    expect(screen.getByTestId('captcha')).toBeInTheDocument();
  });

  it('shows the widget only to a visitor who is actually challenged', async () => {
    render(<CaptchaField onToken={vi.fn()} />);

    await waitFor(() => expect(lastOptions).toBeDefined());
    expect(lastOptions!.appearance).toBe('interaction-only');
  });

  it('hands a solved token to the parent', async () => {
    const onToken = vi.fn();
    render(<CaptchaField onToken={onToken} />);
    await waitFor(() => expect(lastOptions).toBeDefined());

    lastOptions!.callback('solved-token');

    expect(onToken).toHaveBeenCalledWith('solved-token');
  });

  it('clears the token when the challenge expires or errors', async () => {
    const onToken = vi.fn();
    render(<CaptchaField onToken={onToken} />);
    await waitFor(() => expect(lastOptions).toBeDefined());

    lastOptions!['expired-callback']();
    lastOptions!['error-callback']();

    expect(onToken).toHaveBeenNthCalledWith(1, null);
    expect(onToken).toHaveBeenNthCalledWith(2, null);
  });

  it('removes the widget on unmount', async () => {
    const { unmount } = render(<CaptchaField onToken={vi.fn()} />);
    await waitFor(() => expect(lastOptions).toBeDefined());

    unmount();

    expect(remove).toHaveBeenCalledWith('widget-1');
  });
});
