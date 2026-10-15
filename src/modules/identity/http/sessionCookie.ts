import {
  expireCookie,
  parseCookies,
  serializeCookie,
  type CookieOptions,
} from "@/shared/http/cookies.ts";
import { LoginRequest, LOGIN_REQUEST_TTL_MS } from "@/modules/identity/domain/LoginRequest.ts";
import { SESSION_LIFETIME_MS } from "@/modules/identity/domain/Session.ts";

export const SESSION_COOKIE = "mp_session";
export const LOGIN_REQUEST_COOKIE = "mp_login";

/** Only the auth endpoints ever need the in-flight sign-in cookie. */
const LOGIN_REQUEST_PATH = "/api/auth";

/**
 * `SameSite=Lax` is required, not incidental: the OAuth callback is a top-level
 * GET navigation from Discord, which `Strict` would strip the cookie from —
 * while `Lax` still withholds it from cross-site requests that are not
 * top-level safe-method navigations, which keeps `DELETE /api/auth/session`
 * from being forgeable.
 */
function baseOptions(secure: boolean, path: string): Omit<CookieOptions, "maxAgeSeconds"> {
  return { path, secure, httpOnly: true, sameSite: "Lax" };
}

export function setSessionCookie(token: string, secure: boolean): string {
  return serializeCookie(SESSION_COOKIE, token, {
    ...baseOptions(secure, "/"),
    maxAgeSeconds: Math.floor(SESSION_LIFETIME_MS / 1000),
  });
}

export function clearSessionCookie(secure: boolean): string {
  return expireCookie(SESSION_COOKIE, baseOptions(secure, "/"));
}

export function readSessionToken(request: Request): string | null {
  return parseCookies(request.headers.get("cookie")).get(SESSION_COOKIE) ?? null;
}

export function setLoginRequestCookie(loginRequest: LoginRequest, secure: boolean): string {
  const encoded = Buffer.from(
    JSON.stringify({
      state: loginRequest.state,
      codeVerifier: loginRequest.codeVerifier,
      expiresAt: loginRequest.expiresAt.getTime(),
    }),
  ).toString("base64url");

  return serializeCookie(LOGIN_REQUEST_COOKIE, encoded, {
    ...baseOptions(secure, LOGIN_REQUEST_PATH),
    maxAgeSeconds: Math.floor(LOGIN_REQUEST_TTL_MS / 1000),
  });
}

export function clearLoginRequestCookie(secure: boolean): string {
  return expireCookie(LOGIN_REQUEST_COOKIE, baseOptions(secure, LOGIN_REQUEST_PATH));
}

/**
 * Rebuilds the in-flight sign-in from the browser's cookie. Returns null for
 * anything malformed — the cookie is attacker-reachable, so a bad value is an
 * ordinary outcome, not an exception.
 */
export function readLoginRequest(request: Request): LoginRequest | null {
  const encoded = parseCookies(request.headers.get("cookie")).get(LOGIN_REQUEST_COOKIE);
  if (encoded === undefined) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;

    const { state, codeVerifier, expiresAt } = parsed as Record<string, unknown>;
    if (
      typeof state !== "string" ||
      typeof codeVerifier !== "string" ||
      typeof expiresAt !== "number"
    ) {
      return null;
    }

    return LoginRequest.restore({ state, codeVerifier, expiresAt: new Date(expiresAt) });
  } catch {
    return null;
  }
}
