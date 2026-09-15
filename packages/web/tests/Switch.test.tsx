import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../components/ui/Switch';

describe('Switch', () => {
  it('exposes its state via role and aria-checked, not just color', () => {
    render(<Switch checked={true} onChange={vi.fn()} label="Disable link" />);

    expect(screen.getByRole('switch', { name: 'Disable link' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('calls onChange on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} label="Enable link" />);

    await user.click(screen.getByRole('switch', { name: 'Enable link' }));

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('is not clickable while disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Switch checked={false} onChange={onChange} disabled label="Enable link" />);

    await user.click(screen.getByRole('switch', { name: 'Enable link' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
