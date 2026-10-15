import { describe, expect, test } from "bun:test";
import { SESSION_LIFETIME_MS, Session } from "@/modules/identity/domain/Session.ts";

const OPENED_AT = new Date("2026-08-13T10:00:00.000Z");

describe("Session", () => {
  test("expires exactly one lifetime after it was opened", () => {
    const session = Session.open("hash-1", "user-1", OPENED_AT);

    expect(session.expiresAt.getTime()).toBe(OPENED_AT.getTime() + SESSION_LIFETIME_MS);
  });

  test("is live one millisecond before expiry", () => {
    const session = Session.open("hash-1", "user-1", OPENED_AT);
    const justBefore = new Date(session.expiresAt.getTime() - 1);

    expect(session.isExpired(justBefore)).toBe(false);
  });

  test("is expired at the instant it reaches expiry", () => {
    const session = Session.open("hash-1", "user-1", OPENED_AT);

    expect(session.isExpired(session.expiresAt)).toBe(true);
  });

  test("survives a round trip through storage unchanged", () => {
    const original = Session.open("hash-1", "user-1", OPENED_AT);

    const restored = Session.restore(original.toSnapshot());

    expect(restored.toSnapshot()).toEqual(original.toSnapshot());
  });
});
