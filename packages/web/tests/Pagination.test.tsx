import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pagination } from '../components/Pagination';

describe('Pagination', () => {
  it('renders nothing when there are no results at all', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} total={0} onPageChange={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count but hides prev/next when everything fits on one page', () => {
    render(<Pagination page={1} totalPages={1} total={3} onPageChange={vi.fn()} />);

    expect(screen.getByText('Page 1 of 1 · 3 links')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });

  it('shows prev/next once there is more than one page', () => {
    render(<Pagination page={1} totalPages={3} total={25} onPageChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
  });
});
