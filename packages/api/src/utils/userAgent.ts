import { UAParser } from 'ua-parser-js';
import { DeviceType } from '../generated/prisma/enums.js';

export interface ParsedUserAgent {
  deviceType: DeviceType;
  browser: string | null;
  os: string | null;
}

const UNPARSED: ParsedUserAgent = {
  deviceType: DeviceType.UNKNOWN,
  browser: null,
  os: null,
};

/**
 * Maps ua-parser's device type onto our enum.
 *
 * The important case is `undefined`: ua-parser only sets device.type for
 * non-desktop devices, so a desktop browser reports no type at all. Treating
 * that as UNKNOWN would file the majority of real traffic under "unknown", so
 * an unset type with a recognised OS or browser is read as desktop.
 */
function toDeviceType(rawType: string | undefined, recognised: boolean): DeviceType {
  switch (rawType) {
    case 'mobile':
      return DeviceType.MOBILE;
    case 'tablet':
      return DeviceType.TABLET;
    case undefined:
      return recognised ? DeviceType.DESKTOP : DeviceType.UNKNOWN;
    default:
      // console, smarttv, wearable, embedded, xr: real but not a bucket the
      // dashboard charts, and calling them desktop would be a lie.
      return DeviceType.UNKNOWN;
  }
}

export function parseUserAgent(userAgent: string | null): ParsedUserAgent {
  if (!userAgent) return UNPARSED;

  const { browser, os, device } = new UAParser(userAgent).getResult();
  const recognised = Boolean(browser.name || os.name);

  return {
    deviceType: toDeviceType(device.type, recognised),
    browser: browser.name ?? null,
    os: os.name ?? null,
  };
}
