// The ambient test env sets no TURNSTILE_SECRET_KEY, so a static import
// here sees the feature off - the state local runs, CI and the rest of this
// suite depend on.
import { describe, expect, it, vi } from 'vitest';
import { isCaptchaConfigured } from '../../src/lib/captcha.js';
import { requireCaptcha } from '../../src/middleware/captcha.js';

describe('an unconfigured captcha', () => {
  it('reports itself unconfigured', () => {
    expect(isCaptchaConfigured()).toBe(false);
  });

  it('passes a tokenless request straight through, calling nothing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const next = vi.fn();

    await requireCaptcha()({ body: {} } as never, {} as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
