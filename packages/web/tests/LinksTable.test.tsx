import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LinkDto } from '@linkpulse/shared';
import * as clipboard from '../lib/clipboard';
import { LinksTable } from '../components/LinksTable';
import { jsonResponse, renderWithQuery } from './test-utils';

function makeLink(overrides: Partial<LinkDto> = {}): LinkDto {
  return {
    id: '1',
    shortCode: 'abc1234',
    shortUrl: 'http://localhost:4001/abc1234',
    originalUrl: 'https://example.com/destination',
    isActive: true,
    expiresAt: null,
    clickCount: 42,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LinksTable', () => {
  it('shows an empty state with no links', () => {
    renderWithQuery(<LinksTable links={[]} />);

    expect(screen.getByText(/no links yet/i)).toBeInTheDocument();
  });

  it('renders each link’s short code, destination and click count', () => {
    renderWithQuery(<LinksTable links={[makeLink()]} />);

    expect(screen.getByText('localhost:4001/abc1234')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/destination')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('copies the short url to the clipboard', async () => {
    const copySpy = vi.spyOn(clipboard, 'copyToClipboard').mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithQuery(<LinksTable links={[makeLink()]} />);

    await user.click(screen.getByRole('button', { name: 'Copy short URL' }));

    await waitFor(() => expect(copySpy).toHaveBeenCalledWith('http://localhost:4001/abc1234'));
  });

  it('requires a second click before actually deleting', async () => {
    // A single click must never delete anything - that is the entire point
    // of the two-step confirm.
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    renderWithQuery(<LinksTable links={[makeLink()]} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete link' });
    await user.click(deleteButton);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
  });

  it('deletes on the second click', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderWithQuery(<LinksTable links={[makeLink()]} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete link' });
    await user.click(deleteButton);
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/links/1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('toggles active status via the switch, and reflects the current state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, makeLink({ isActive: false })),
    );
    const user = userEvent.setup();
    renderWithQuery(<LinksTable links={[makeLink({ isActive: true })]} />);

    const toggle = screen.getByRole('switch', { name: 'Disable link' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Active')).toBeInTheDocument();

    await user.click(toggle);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/links/1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      }),
    );
  });

  it('shows an off switch and a disabled label for an inactive link', () => {
    renderWithQuery(<LinksTable links={[makeLink({ isActive: false })]} />);

    expect(screen.getByRole('switch', { name: 'Enable link' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  describe('editing the destination url', () => {
    it('shows an editable input, pre-filled, on the pencil click', async () => {
      const user = userEvent.setup();
      renderWithQuery(<LinksTable links={[makeLink()]} />);

      await user.click(screen.getByRole('button', { name: 'Edit destination URL' }));

      expect(screen.getByLabelText('Destination URL')).toHaveValue(
        'https://example.com/destination',
      );
    });

    it('rejects an invalid url client-side, without calling the api', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const user = userEvent.setup();
      renderWithQuery(<LinksTable links={[makeLink()]} />);

      await user.click(screen.getByRole('button', { name: 'Edit destination URL' }));
      await user.clear(screen.getByLabelText('Destination URL'));
      await user.type(screen.getByLabelText('Destination URL'), 'not-a-url');
      await user.click(screen.getByRole('button', { name: 'Save destination URL' }));

      expect(await screen.findByText(/absolute http/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('saves a valid url and leaves edit mode', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(200, makeLink({ originalUrl: 'https://example.com/new' })),
      );
      const user = userEvent.setup();
      renderWithQuery(<LinksTable links={[makeLink()]} />);

      await user.click(screen.getByRole('button', { name: 'Edit destination URL' }));
      await user.clear(screen.getByLabelText('Destination URL'));
      await user.type(screen.getByLabelText('Destination URL'), 'https://example.com/new');
      await user.click(screen.getByRole('button', { name: 'Save destination URL' }));

      await waitFor(() =>
        expect(globalThis.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/links/1'),
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ url: 'https://example.com/new' }),
          }),
        ),
      );
      await waitFor(() =>
        expect(screen.queryByLabelText('Destination URL')).not.toBeInTheDocument(),
      );
    });

    it('cancels on Escape without calling the api', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const user = userEvent.setup();
      renderWithQuery(<LinksTable links={[makeLink()]} />);

      await user.click(screen.getByRole('button', { name: 'Edit destination URL' }));
      await user.keyboard('{Escape}');

      expect(screen.queryByLabelText('Destination URL')).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shows a conflict from the api as an inline error, staying in edit mode', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(409, { error: { code: 'CONFLICT', message: 'Something went wrong there' } }),
      );
      const user = userEvent.setup();
      renderWithQuery(<LinksTable links={[makeLink()]} />);

      await user.click(screen.getByRole('button', { name: 'Edit destination URL' }));
      await user.clear(screen.getByLabelText('Destination URL'));
      await user.type(screen.getByLabelText('Destination URL'), 'https://example.com/new');
      await user.click(screen.getByRole('button', { name: 'Save destination URL' }));

      expect(await screen.findByText('Something went wrong there')).toBeInTheDocument();
      expect(screen.getByLabelText('Destination URL')).toBeInTheDocument();
    });
  });
});
