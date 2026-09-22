// No site key in the ambient test env - the state local runs, CI and any
// deployment without Cloudflare keys are in.
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CaptchaField, captchaRequired } from '../components/CaptchaField';

describe('CaptchaField, with no site key', () => {
  it('does not require a captcha', () => {
    expect(captchaRequired).toBe(false);
  });

  it('renders nothing and loads no script', () => {
    const { container } = render(<CaptchaField onToken={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(document.querySelector('script[src*="turnstile"]')).toBeNull();
  });
});
