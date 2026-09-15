import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OAuthButtons } from '../components/OAuthButtons';
import { API_BASE_URL } from '../lib/env';

describe('OAuthButtons', () => {
  it('links each provider to its own real navigation, not a fetch target', () => {
    render(<OAuthButtons />);

    expect(screen.getByRole('link', { name: /github/i })).toHaveAttribute(
      'href',
      `${API_BASE_URL}/api/auth/oauth/github`,
    );
    expect(screen.getByRole('link', { name: /google/i })).toHaveAttribute(
      'href',
      `${API_BASE_URL}/api/auth/oauth/google`,
    );
  });
});
