/**
 * Tiny dependency-free user-agent parser. Produces friendly labels for the
 * login-history report (browser / OS / device type) from the raw UA string.
 *
 * Deliberately heuristic and forgiving: UA strings are unstandardized, so this
 * covers the common desktop/mobile browsers and degrades to "Unknown" rather
 * than throwing or guessing wildly. Order matters — more specific checks first
 * (e.g. Edge before Chrome, since Edge's UA contains "Chrome").
 */

export interface ParsedUserAgent {
  /** e.g. "Chrome", "Safari", "Firefox", "Edge", or "Unknown". */
  browser: string;
  /** e.g. "Windows", "macOS", "iOS", "Android", "Linux", or "Unknown". */
  os: string;
  /** "mobile" | "tablet" | "desktop". */
  deviceType: 'mobile' | 'tablet' | 'desktop';
  /** A single human label, e.g. "Chrome on macOS". */
  label: string;
}

function detectBrowser(ua: string): string {
  // Edge (Chromium): "Edg/"; legacy Edge: "Edge/".
  if (/\bEdg(e|A|iOS)?\//i.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/i.test(ua)) return 'Opera';
  if (/\bSamsungBrowser\//i.test(ua)) return 'Samsung Internet';
  // Chrome (and Chromium) — but NOT Edge/Opera, handled above.
  if (/\bChrome\/|\bCriOS\//i.test(ua)) return 'Chrome';
  if (/\bFirefox\/|\bFxiOS\//i.test(ua)) return 'Firefox';
  // Safari last: Chrome/Edge UAs also contain "Safari".
  if (/\bSafari\//i.test(ua)) return 'Safari';
  return 'Unknown';
}

function detectOs(ua: string): string {
  if (/\bWindows NT\b/i.test(ua)) return 'Windows';
  if (/\biPhone\b|\biPad\b|\biPod\b/i.test(ua)) return 'iOS';
  if (/\bAndroid\b/i.test(ua)) return 'Android';
  // "Mac OS X" appears on iOS too, so check iOS first (done above).
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return 'macOS';
  if (/\bLinux\b/i.test(ua)) return 'Linux';
  return 'Unknown';
}

function detectDeviceType(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (
    /\biPad\b/i.test(ua) ||
    (/\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua))
  )
    return 'tablet';
  if (/\bMobi|\biPhone\b|\biPod\b|\bAndroid\b/i.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Parse a raw UA string. Returns null when there's nothing to parse, so the
 * caller can decide how to present a missing UA.
 */
export function parseUserAgent(
  ua: string | null | undefined,
): ParsedUserAgent | null {
  if (!ua || ua.trim().length === 0) return null;
  const browser = detectBrowser(ua);
  const os = detectOs(ua);
  const deviceType = detectDeviceType(ua);

  const label =
    browser === 'Unknown' && os === 'Unknown'
      ? 'Unknown device'
      : `${browser === 'Unknown' ? 'Browser' : browser} on ${
          os === 'Unknown' ? 'unknown OS' : os
        }`;

  return { browser, os, deviceType, label };
}
