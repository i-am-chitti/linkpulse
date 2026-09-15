import { ImageResponse } from 'next/og';
import { renderIconGlyph } from './iconGlyph';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(renderIconGlyph(size.width), { ...size });
}
