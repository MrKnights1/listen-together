import { describe, expect, test } from "bun:test";
import { expireCookie, parseCookies, serializeCookie } from "@/shared/http/cookies.ts";

const OPTIONS = {
  maxAgeSeconds: 3600,
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Lax",
} as const;

describe("parseCookies", () => {
  test("reads nothing when the request sent no cookie header", () => {
    expect(parseCookies(null).size).toBe(0);
  });

  test("reads every pair in the header", () => {
    const cookies = parseCookies("first=one; second=two");

    expect(cookies.get("first")).toBe("one");
    expect(cookies.get("second")).toBe("two");
  });

  test("decodes a percent-encoded value", () => {
    expect(parseCookies("session=a%20b").get("session")).toBe("a b");
  });

  test("round-trips a value through serializeCookie", () => {
    const header = serializeCookie("session", "a b/c=d", OPTIONS).split(";")[0] ?? "";

    expect(parseCookies(header).get("session")).toBe("a b/c=d");
  });

  test("skips a pair with no name", () => {
    expect(parseCookies("=orphan; session=abc").has("")).toBe(false);
  });

  /**
   * The regression that matters: a bare `%` is a legal cookie octet, so any
   * other cookie on the domain can carry one. Throwing here took out every
   * endpoint that reads a session.
   */
  test("keeps a value that is not valid percent-encoding instead of throwing", () => {
    expect(parseCookies("analytics=100%").get("analytics")).toBe("100%");
  });

  test("still reads the session when another cookie is malformed", () => {
    const cookies = parseCookies("analytics=100%; mp_session=abc; broken=%E0%A4%A");

    expect(cookies.get("mp_session")).toBe("abc");
    expect(cookies.get("broken")).toBe("%E0%A4%A");
  });
});

describe("serializeCookie", () => {
  test("encodes the value so a delimiter cannot escape the pair", () => {
    expect(serializeCookie("session", "a;b", OPTIONS)).toStartWith("session=a%3Bb;");
  });

  test("carries the attributes it was given", () => {
    const header = serializeCookie("session", "abc", OPTIONS);

    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=3600");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
  });

  test("omits HttpOnly and Secure when they are off", () => {
    const header = serializeCookie("session", "abc", {
      ...OPTIONS,
      httpOnly: false,
      secure: false,
    });

    expect(header).not.toContain("HttpOnly");
    expect(header).not.toContain("Secure");
  });
});

describe("expireCookie", () => {
  test("expires the cookie immediately", () => {
    expect(expireCookie("session", OPTIONS)).toContain("Max-Age=0");
  });

  test("keeps the path, without which the browser would not clear it", () => {
    expect(expireCookie("session", { ...OPTIONS, path: "/api" })).toContain("Path=/api");
  });
});
