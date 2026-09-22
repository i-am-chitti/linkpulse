// The captcha paths only exist when a site key is configured, which lib/env.ts
// reads once at module load - hence the stubbed env and dynamic imports. The
// rest of GuestShortenForm is covered in GuestShortenForm.test.tsx, which runs
// with no key and so never reaches these branches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinkDto } from '@linkpulse/shared';
import { jsonResponse } from './test-utils';

vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-site-key');

const { GuestShortenForm } = await import('../components/GuestShortenForm');

let solve: ((token: string) => void) | undefined;

const LINK: LinkDto = {
  id: '1',
  shortCode: 'abc1234',
  shortUrl: 'http://localhost:4001/abc1234',
  originalUrl: 'https://example.com',
  isActive: true,
  expiresAt: null,
  clickCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  solve = undefined;
  window.turnstile = {
    render: (_container, options) => {
      solve = (options as { callback: (token: string) => void }).callback;
      return 'widget-1';
    },
    remove: vi.fn(),
  };
});

afterEach(() => {
  delete window.turnstile;
  vi.restoreAllMocks();
});

describe('GuestShortenForm with a captcha', () => {
  it('refuses to submit before the challenge resolves', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText('Please complete the captcha.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retracts that prompt once the token lands, rather than leaving it stale', async () => {
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));
    await screen.findByText('Please complete the captcha.');

    await waitFor(() => expect(solve).toBeDefined());
    solve!('solved-token');

    await waitFor(() =>
      expect(screen.queryByText('Please complete the captcha.')).not.toBeInTheDocument(),
    );
  });

  it('sends the token with the request once solved', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, LINK));
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await waitFor(() => expect(solve).toBeDefined());
    solve!('solved-token');
    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    await screen.findByText('localhost:4001/abc1234');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(init!.body as string).captchaToken).toBe('solved-token');
  });
});
