import { describe, expect, test } from "bun:test";
import {
  SESSION_LIFETIME_MS,
  SESSION_RENEWAL_INTERVAL_MS,
  Session,
} from "@/modules/identity/domain/Session.ts";

const OPENED_AT = new Date("2026-08-13T10:00:00.000Z");
const DAY_MS = 86_400_000;

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

  test("lives 400 days unused, the longest a browser keeps a cookie", () => {
    expect(SESSION_LIFETIME_MS).toBe(400 * DAY_MS);
  });

  test("is not due for renewal until a day has passed", () => {
    const session = Session.open("hash-1", "user-1", OPENED_AT);
    const atInterval = OPENED_AT.getTime() + SESSION_RENEWAL_INTERVAL_MS;

    expect(session.isDueForRenewal(OPENED_AT)).toBe(false);
    expect(session.isDueForRenewal(new Date(atInterval - 1))).toBe(false);
    expect(session.isDueForRenewal(new Date(atInterval))).toBe(true);
  });

  test("renewing gives a full lifetime from now and keeps everything else", () => {
    const session = Session.open("hash-1", "user-1", OPENED_AT);
    const later = new Date(OPENED_AT.getTime() + 300 * DAY_MS);

    const renewed = session.renewed(later);

    expect(renewed.expiresAt.getTime()).toBe(later.getTime() + SESSION_LIFETIME_MS);
    expect(renewed.tokenHash).toBe("hash-1");
    expect(renewed.userId).toBe("user-1");
    expect(renewed.createdAt).toEqual(OPENED_AT);
    expect(renewed.isDueForRenewal(later)).toBe(false);
  });

  test("a session opened under the old 30-day lifetime is due for renewal at once", () => {
    const old = Session.restore({
      tokenHash: "hash-1",
      userId: "user-1",
      createdAt: OPENED_AT,
      expiresAt: new Date(OPENED_AT.getTime() + 30 * DAY_MS),
    });

    expect(old.isDueForRenewal(new Date(OPENED_AT.getTime() + 1000))).toBe(true);
  });

  test("survives a round trip through storage unchanged", () => {
    const original = Session.open("hash-1", "user-1", OPENED_AT);

    const restored = Session.restore(original.toSnapshot());

    expect(restored.toSnapshot()).toEqual(original.toSnapshot());
  });
});
