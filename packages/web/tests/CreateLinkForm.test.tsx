import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateLinkForm } from '../components/CreateLinkForm';
import { jsonResponse, renderWithQuery } from './test-utils';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CreateLinkForm', () => {
  it('rejects an empty url without calling the api', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    renderWithQuery(<CreateLinkForm />);

    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText(/required/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-http url with a field-level message, matching the api rule', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const user = userEvent.setup();
    renderWithQuery(<CreateLinkForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText(/absolute http/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits a valid url and calls onCreated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, {
        id: '1',
        shortCode: 'abc1234',
        shortUrl: 'http://localhost:4001/abc1234',
        originalUrl: 'https://example.com',
        isActive: true,
        expiresAt: null,
        clickCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<CreateLinkForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('treats a blank optional alias as not provided, not as an invalid one', async () => {
    // An untouched optional field is "", and customAliasSchema's min-length
    // check rejects "" the same way it rejects "ab" unless normalized first.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(201, {
        id: '1',
        shortCode: 'abc1234',
        shortUrl: 'http://localhost:4001/abc1234',
        originalUrl: 'https://example.com',
        isActive: true,
        expiresAt: null,
        clickCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<CreateLinkForm onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    // customAlias and expiresAt are left blank (the "options" panel is
    // collapsed by default), so this exercises the untouched-field path.
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('exposes the options toggle as a real disclosure control, not plain text', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CreateLinkForm />);

    const toggle = screen.getByRole('button', { name: /custom alias or expiry/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Custom alias')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Custom alias')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide options' })).toBeInTheDocument();
  });

  it('shows a taken-alias conflict from the api as a form-level error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, { error: { code: 'CONFLICT', message: 'That alias is already taken' } }),
    );
    const user = userEvent.setup();
    renderWithQuery(<CreateLinkForm />);

    await user.type(screen.getByLabelText('Destination URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Shorten' }));

    expect(await screen.findByText('That alias is already taken')).toBeInTheDocument();
  });
});
