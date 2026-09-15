import type { ReactElement } from 'react';

/**
 * Shared between icon.tsx and apple-icon.tsx - Next.js requires each to be
 * its own route with its own default export, but the glyph itself is one
 * design scaled to two sizes.
 *
 * A letterform, not a literal chain-link glyph: an early version drew two
 * crossed rounded bars meant to echo lucide's Link2, but at favicon scale it
 * read as an "X" (arguably "cancel") rather than a link. A bold single
 * letter is the standard fix real products reach for here (Linear, Vercel,
 * Loom) - it survives being viewed at 16px, which a literal icon usually
 * does not.
 */
export function renderIconGlyph(canvasSize: number): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#296cd8',
        borderRadius: canvasSize * 0.22,
      }}
    >
      <span
        style={{
          fontSize: canvasSize * 0.62,
          fontWeight: 700,
          color: 'white',
          fontFamily: 'sans-serif',
          lineHeight: 1,
          // Optical centering: a capital L's glyph sits slightly left/low of
          // its box, so an unshifted flex-center reads off-center.
          transform: `translate(${canvasSize * 0.02}px, ${canvasSize * -0.02}px)`,
        }}
      >
        L
      </span>
    </div>
  );
}
