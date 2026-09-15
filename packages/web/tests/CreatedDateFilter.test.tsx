import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreatedDateFilter } from '../components/CreatedDateFilter';

/** The component deliberately uses the local date, not UTC - match that here. */
function localToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

describe('CreatedDateFilter', () => {
  it('reflects the current value in both inputs', () => {
    render(
      <CreatedDateFilter value={{ from: '2026-01-01', to: '2026-01-31' }} onChange={vi.fn()} />,
    );

    expect(screen.getByLabelText('Created after')).toHaveValue('2026-01-01');
    expect(screen.getByLabelText('Created before')).toHaveValue('2026-01-31');
  });

  it('calls onChange with the new from date, keeping to untouched', () => {
    // fireEvent.change, not user.type: jsdom's segmented date input does not
    // reliably accept simulated keystrokes the way a text input does.
    const onChange = vi.fn();
    render(<CreatedDateFilter value={{ to: '2026-01-31' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Created after'), { target: { value: '2026-01-15' } });

    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-01-15', to: '2026-01-31' });
  });

  it('clears a bound to undefined rather than an empty string', () => {
    const onChange = vi.fn();
    render(<CreatedDateFilter value={{ from: '2026-01-15' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Created after'), { target: { value: '' } });

    expect(onChange).toHaveBeenLastCalledWith({ from: undefined });
  });

  it('caps the max attribute at today, so the picker cannot offer a future date', () => {
    render(<CreatedDateFilter value={{}} onChange={vi.fn()} />);

    const todayIso = localToday();
    expect(screen.getByLabelText('Created after')).toHaveAttribute('max', todayIso);
    expect(screen.getByLabelText('Created before')).toHaveAttribute('max', todayIso);
  });

  it('clamps a manually-typed future date to today, since max alone does not block it', () => {
    // A native date input's `max` only restricts its own picker UI - a
    // directly typed value still fires onChange uncapped, so the clamp has
    // to run in the handler too. This is what a user reported actually
    // seeing: future dates accepted by the filter.
    const onChange = vi.fn();
    render(<CreatedDateFilter value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Created after'), { target: { value: '2099-01-01' } });

    const todayIso = localToday();
    expect(onChange).toHaveBeenLastCalledWith({ from: todayIso });
  });
});
