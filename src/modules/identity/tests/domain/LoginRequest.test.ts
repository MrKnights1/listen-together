import { describe, expect, test } from "bun:test";
import { LOGIN_REQUEST_TTL_MS, LoginRequest } from "@/modules/identity/domain/LoginRequest.ts";
import { LoginRequestExpired, StateMismatch } from "@/modules/identity/domain/errors.ts";

const STARTED_AT = new Date("2026-08-13T10:00:00.000Z");

function startedRequest(): LoginRequest {
  return LoginRequest.start("state-abc", "verifier-xyz", STARTED_AT);
}

describe("LoginRequest", () => {
  test("accepts the callback that carries its own state", () => {
    expect(() => startedRequest().verify("state-abc", STARTED_AT)).not.toThrow();
  });

  test("rejects a callback carrying someone else's state", () => {
    expect(() => startedRequest().verify("state-forged", STARTED_AT)).toThrow(StateMismatch);
  });

  test("rejects a state that only shares a prefix", () => {
    expect(() => startedRequest().verify("state-ab", STARTED_AT)).toThrow(StateMismatch);
  });

  test("is still usable one millisecond before its TTL runs out", () => {
    const justBefore = new Date(STARTED_AT.getTime() + LOGIN_REQUEST_TTL_MS - 1);

    expect(() => startedRequest().verify("state-abc", justBefore)).not.toThrow();
  });

  test("expires once the TTL has elapsed, even with the right state", () => {
    const afterTtl = new Date(STARTED_AT.getTime() + LOGIN_REQUEST_TTL_MS);

    expect(() => startedRequest().verify("state-abc", afterTtl)).toThrow(LoginRequestExpired);
  });

  test("checks expiry before state, so a stale forged callback reports expiry", () => {
    const afterTtl = new Date(STARTED_AT.getTime() + LOGIN_REQUEST_TTL_MS);

    expect(() => startedRequest().verify("state-forged", afterTtl)).toThrow(LoginRequestExpired);
  });
});
