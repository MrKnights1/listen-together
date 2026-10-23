import { describe, expect, test } from "bun:test";
import { ClockSync } from "@/modules/player/ui/ClockSync.ts";

describe("ClockSync", () => {
  test("is not synced, and refuses to guess, before the first pong", () => {
    const clock = new ClockSync();

    expect(clock.synced).toBe(false);
    expect(() => clock.serverNow(0)).toThrow("ping the server first");
  });

  test("places the server's reading halfway through the round trip", () => {
    const clock = new ClockSync();
    // Sent at local 1000, answered at local 1100; the server read 5_000_050 meanwhile.
    clock.record(1000, 1100, 5_000_050);

    expect(clock.serverNow(1050)).toBe(5_000_050);
    expect(clock.serverNow(2050)).toBe(5_001_050);
  });

  test("trusts the sample with the shortest round trip", () => {
    const clock = new ClockSync();
    clock.record(0, 400, 10_000); // slow: offset 9800, error up to 200
    clock.record(1000, 1020, 11_010); // fast: offset 10_000, error up to 10

    expect(clock.bestRttMs).toBe(20);
    expect(clock.serverNow(2000)).toBe(12_000);
  });

  test("keeps only the last eight samples, so a changed route is followed", () => {
    const clock = new ClockSync();
    clock.record(0, 1, 100); // very fast, but old
    for (let i = 1; i <= 8; i += 1) clock.record(i * 1000, i * 1000 + 50, 0);

    expect(clock.bestRttMs).toBe(50);
  });

  test("ignores a sample whose answer came before its question", () => {
    const clock = new ClockSync();
    clock.record(1000, 900, 5000);

    expect(clock.synced).toBe(false);
  });

  test("keeps telling the time on its old estimate once marked stale", () => {
    const clock = new ClockSync();
    clock.record(0, 10, 100);

    clock.markStale();

    expect(clock.synced).toBe(true);
    expect(clock.serverNow(1005)).toBe(1100);
  });

  test("lets the first fresh sample replace the stale ones, however slow its round trip", () => {
    const clock = new ClockSync();
    clock.record(0, 10, 100); // fast: offset 95
    clock.markStale();

    clock.record(1000, 1200, 2_000_100); // slow: offset 1_999_000

    expect(clock.bestRttMs).toBe(200);
    expect(clock.serverNow(3000)).toBe(2_002_000);
  });

  test("stays synced through a later sample once fresh again", () => {
    const clock = new ClockSync();
    clock.record(0, 10, 100);
    clock.markStale();
    clock.record(1000, 1200, 2_000_100);

    clock.record(2000, 2010, 2_001_005); // fast again: offset 1_999_000

    expect(clock.bestRttMs).toBe(10);
  });
});
