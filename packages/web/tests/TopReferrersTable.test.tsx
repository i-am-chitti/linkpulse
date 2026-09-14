import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopReferrersTable } from '../components/charts/TopReferrersTable';

describe('TopReferrersTable', () => {
  it('shows an empty state with no referrers', () => {
    render(<TopReferrersTable referrers={[]} />);

    expect(screen.getByText(/no referrers/i)).toBeInTheDocument();
  });

  it('renders each referrer with its click count, direct-only', () => {
    render(
      <TopReferrersTable
        referrers={[
          { referrer: 'twitter.com', clicks: 42 },
          { referrer: 'direct', clicks: 10 },
        ]}
      />,
    );

    expect(screen.getByText('twitter.com')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('direct')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
