export interface CookieOptions {
  maxAgeSeconds: number;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/**
 * A bare `%` is a legal cookie octet under RFC 6265 but an illegal percent
 * escape, so `decodeURIComponent` throws on values we did not write. The browser
 * sends the whole jar on every request, so a throw here would take out every
 * endpoint that reads a session until the user cleared their cookies by hand.
 */
function decodeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === null) return cookies;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name !== "") cookies.set(name, decodeValue(value));
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Expires a cookie by name. Must match the original Path to actually clear it. */
export function expireCookie(name: string, options: Omit<CookieOptions, "maxAgeSeconds">): string {
  return serializeCookie(name, "", { ...options, maxAgeSeconds: 0 });
}
