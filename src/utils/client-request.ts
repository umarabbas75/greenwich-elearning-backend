import { Request } from 'express';

/**
 * Best-effort client IP. On Vercel/behind proxies the real client IP is the
 * FIRST entry of the `x-forwarded-for` chain; `req.ip`/socket address would be
 * the proxy. Returns null if nothing usable is present (never throws).
 */
export function getClientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    // "client, proxy1, proxy2" — first hop is the client.
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    const first = fwd[0]?.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real;
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

/**
 * Server-side HTTP-client UAs that mean "this request came from a backend/proxy
 * hop, not a real browser". If the frontend calls the API through a Next.js
 * route/server-action without forwarding the browser's User-Agent, we'd see one
 * of these — recording it as a "device" is misleading, so we treat it as null.
 * (The real fix is the FE forwarding the browser UA; this keeps data honest
 * meanwhile.)
 */
const NON_BROWSER_UA =
  /^(node|node-fetch|undici|axios|got|python-requests|curl|wget|okhttp|go-http-client|java|PostmanRuntime)\b/i;

/**
 * Client user-agent string, trimmed, or null. Returns null for empty UAs and
 * for known server-side HTTP clients (so the login report doesn't show "node"
 * as a device).
 */
export function getUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  if (typeof ua !== 'string' || ua.length === 0) return null;
  if (NON_BROWSER_UA.test(ua.trim())) return null;
  return ua.slice(0, 512);
}
