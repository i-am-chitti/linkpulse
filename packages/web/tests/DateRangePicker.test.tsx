import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateRangePicker, rangeForDays } from '../components/DateRangePicker';

describe('rangeForDays', () => {
  it('spans exactly the requested number of days, inclusive', () => {
    const { from, to } = rangeForDays(7);

    const spanDays = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    expect(spanDays).toBe(6);
  });

  it('ends on today', () => {
    const { to } = rangeForDays(30);
    expect(to).toBe(new Date().toISOString().slice(0, 10));
  });

  it('produces YYYY-MM-DD, matching what the api analytics query expects', () => {
    const { from, to } = rangeForDays(90);
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('DateRangePicker', () => {
  it('highlights the active preset', () => {
    render(<DateRangePicker activeDays={30} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: '30 days' })).toHaveClass('bg-brand');
    expect(screen.getByRole('button', { name: '7 days' })).not.toHaveClass('bg-brand');
  });

  it('calls onSelect with the clicked preset’s day count', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<DateRangePicker activeDays={30} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: '90 days' }));

    expect(onSelect).toHaveBeenCalledWith(90);
  });
});
