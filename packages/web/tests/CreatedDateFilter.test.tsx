import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreatedDateFilter } from '../components/CreatedDateFilter';

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
});
