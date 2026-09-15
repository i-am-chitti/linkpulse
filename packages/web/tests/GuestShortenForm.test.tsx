import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinkDto } from '@linkpulse/shared';
import * as clipboard from '../lib/clipboard';
import { GuestShortenForm } from '../components/GuestShortenForm';
import { jsonResponse } from './test-utils';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('GuestShortenForm', () => {
  it('rejects an empty url without calling the api', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shortens a url with no auth header and shows the result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, LINK));
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText('localhost:4001/abc1234')).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Headers).has('authorization')).toBe(false);
  });

  it('copies the short url to the clipboard', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(201, LINK));
    const copySpy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));
    await screen.findByText('localhost:4001/abc1234');

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copySpy).toHaveBeenCalledWith('http://localhost:4001/abc1234');
  });

  it('shows a rate-limit error from the api as a form-level message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(429, { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests.' } }),
    );
    const user = userEvent.setup();
    render(<GuestShortenForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText('Too many requests.')).toBeInTheDocument();
  });
});
