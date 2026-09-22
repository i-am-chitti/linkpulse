'use client';

import { useEffect, useRef } from 'react';
import { TURNSTILE_SITE_KEY } from '../lib/env';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: 'light' | 'dark' | 'auto';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/**
 * Once per page, not once per widget: a second <script> for the same src
 * re-registers window.turnstile underneath an already-rendered widget.
 */
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  const script = existing ?? document.createElement('script');

  const ready = new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('turnstile failed to load')));
  });

  if (!existing) {
    script.src = SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }

  return ready;
}

/**
 * Renders nothing without a site key, so a deployment with no Cloudflare
 * account keeps working - the API applies the same rule (lib/captcha.ts).
 */
export function CaptchaField({ onToken }: { onToken: (token: string | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * A ref, so the render effect below depends on nothing: a parent passing a
   * fresh arrow function each render would otherwise rebuild the widget on
   * every keystroke. Assigned in an effect - a ref write during render is a
   * side effect React may discard.
   */
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const container = containerRef.current;
    if (!container) return;

    let widgetId: string | undefined;
    let cancelled = false;

    void loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId = window.turnstile.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          // Pinned, not the 'auto' default: auto follows the visitor's OS
          // setting and renders a dark widget on these light-only pages.
          theme: 'light',
          callback: (token) => onTokenRef.current(token),
          // Tokens are single-use and expire after ~5 minutes: clear, so the
          // form blocks rather than submitting a stale one.
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;

  // w-fit keeps the box to the injected iframe's own width, mx-auto centres
  // it: at ~300px it would otherwise sit out of line with the fields above.
  return <div ref={containerRef} data-testid="captcha" className="mx-auto w-fit" />;
}

export const captchaRequired = Boolean(TURNSTILE_SITE_KEY);

/**
 * Shown when a form is submitted before the challenge resolves. Shared so a
 * form can retract it once the token lands, rather than leaving the visitor
 * told to solve a captcha that already says Success.
 */
export const CAPTCHA_PROMPT = 'Please complete the captcha.';
