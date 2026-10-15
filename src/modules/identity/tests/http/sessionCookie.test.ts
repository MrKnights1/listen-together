import { describe, expect, test } from "bun:test";
import { LoginRequest } from "@/modules/identity/domain/LoginRequest.ts";
import {
  LOGIN_REQUEST_COOKIE,
  SESSION_COOKIE,
  clearSessionCookie,
  readLoginRequest,
  readSessionToken,
  setLoginRequestCookie,
  setSessionCookie,
} from "@/modules/identity/http/sessionCookie.ts";

const NOW = new Date("2026-08-13T10:00:00.000Z");

function requestWithCookie(cookie: string): Request {
  return new Request("http://localhost/api/auth/discord/callback", { headers: { cookie } });
}

describe("session cookie", () => {
  test("is unreadable to scripts and not sent on cross-site posts", () => {
    const cookie = setSessionCookie("token-1", true);

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  test("carries Secure when the app is served over https", () => {
    expect(setSessionCookie("token-1", true)).toContain("Secure");
  });

  test("omits Secure over plain http, so local development still works", () => {
    expect(setSessionCookie("token-1", false)).not.toContain("Secure");
  });

  test("is cleared by expiring it immediately on the same path", () => {
    const cookie = clearSessionCookie(false);

    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/");
  });

  test("round-trips the token through a request header", () => {
    const token = readSessionToken(requestWithCookie(`${SESSION_COOKIE}=abc123`));

    expect(token).toBe("abc123");
  });

  test("reads the token when other cookies are present", () => {
    const token = readSessionToken(
      requestWithCookie(`other=1; ${SESSION_COOKIE}=abc123; another=2`),
    );

    expect(token).toBe("abc123");
  });

  test("reports no token when the request carries no cookies", () => {
    expect(readSessionToken(new Request("http://localhost/"))).toBeNull();
  });
});

describe("login request cookie", () => {
  test("restores the in-flight sign-in it wrote", () => {
    const original = LoginRequest.start("state-abc", "verifier-xyz", NOW);
    const value = setLoginRequestCookie(original, false).split(";")[0] ?? "";

    const restored = readLoginRequest(requestWithCookie(value));

    expect(restored?.state).toBe("state-abc");
    expect(restored?.codeVerifier).toBe("verifier-xyz");
    expect(restored?.expiresAt.getTime()).toBe(original.expiresAt.getTime());
  });

  test("is scoped to the auth endpoints and hidden from scripts", () => {
    const cookie = setLoginRequestCookie(LoginRequest.start("s", "v", NOW), true);

    expect(cookie).toContain("Path=/api/auth");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  test("reports nothing when the cookie is absent", () => {
    expect(readLoginRequest(new Request("http://localhost/"))).toBeNull();
  });

  test("refuses a tampered cookie instead of throwing", () => {
    expect(
      readLoginRequest(requestWithCookie(`${LOGIN_REQUEST_COOKIE}=not-base64-json`)),
    ).toBeNull();
  });

  test("refuses a cookie whose fields are the wrong shape", () => {
    const forged = Buffer.from(
      JSON.stringify({ state: 1, codeVerifier: null, expiresAt: "soon" }),
    ).toString("base64url");

    expect(readLoginRequest(requestWithCookie(`${LOGIN_REQUEST_COOKIE}=${forged}`))).toBeNull();
  });
});
