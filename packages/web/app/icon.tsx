import { ImageResponse } from 'next/og';
import { renderIconGlyph } from './iconGlyph';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(renderIconGlyph(size.width), { ...size });
}
