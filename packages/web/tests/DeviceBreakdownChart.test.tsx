import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeviceBreakdownChart } from '../components/charts/DeviceBreakdownChart';

describe('DeviceBreakdownChart legend', () => {
  it('computes each device’s share of the total', () => {
    render(
      <DeviceBreakdownChart breakdown={{ mobile: 30, desktop: 60, tablet: 10, unknown: 0 }} />,
    );

    expect(screen.getByText('Mobile · 30 (30%)')).toBeInTheDocument();
    expect(screen.getByText('Desktop · 60 (60%)')).toBeInTheDocument();
    expect(screen.getByText('Tablet · 10 (10%)')).toBeInTheDocument();
    expect(screen.getByText('Unknown · 0 (0%)')).toBeInTheDocument();
  });

  it('does not divide by zero when there are no clicks at all', () => {
    render(<DeviceBreakdownChart breakdown={{ mobile: 0, desktop: 0, tablet: 0, unknown: 0 }} />);

    expect(screen.getByText('Mobile · 0 (0%)')).toBeInTheDocument();
  });

  it('carries device identity in a visible label, not color alone', () => {
    // The two lower-contrast slots (aqua, yellow) in this palette's device
    // colors read below 3:1 on the light chart surface - the dataviz
    // method's "relief" requirement, satisfied here by the legend text
    // rather than relying on the swatch color to be distinguishable.
    render(<DeviceBreakdownChart breakdown={{ mobile: 1, desktop: 1, tablet: 1, unknown: 1 }} />);

    for (const label of ['Mobile', 'Desktop', 'Tablet', 'Unknown']) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
  });
});
