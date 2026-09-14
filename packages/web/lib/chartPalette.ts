/**
 * Chart colors, validated with the dataviz skill's `validate_palette.js`
 * against this app's light chart surface (`#fcfcfb`, Tailwind's gray-50 area).
 *
 * Light-mode only, deliberately: nothing else in this app has a dark theme
 * yet (see app/globals.css), so a dark-only chart palette would be
 * inconsistent with every surrounding page rather than more accessible.
 *
 * Sequential (single-hue) charts use SEQUENTIAL_HUE; the four-slot
 * categorical set is for device breakdown, in this fixed order - color
 * identity must never be reassigned when the underlying data changes.
 */
export const SEQUENTIAL_HUE = '#2a78d6';

export const CATEGORICAL = {
  mobile: '#2a78d6', // slot 1, blue
  desktop: '#eb6834', // slot 2, orange
  tablet: '#1baf7a', // slot 3, aqua
  unknown: '#eda100', // slot 4, yellow
} as const;

/** Chart chrome & ink, from the validated light palette. */
export const CHART_INK = {
  surface: '#fcfcfb',
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
} as const;
