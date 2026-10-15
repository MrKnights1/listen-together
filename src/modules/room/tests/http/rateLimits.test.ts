import { describe, expect, test } from "bun:test";
import { PersonLimits, TokenBucket } from "@/modules/room/http/rateLimits.ts";
import { FakeClock } from "@/modules/room/tests/support/fakes.ts";

const NOW = 1_760_000_000_000;

describe("TokenBucket", () => {
  test("allows a burst up to its capacity, then refuses", () => {
    const bucket = new TokenBucket(3, 1000, new FakeClock(NOW));

    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  test("refills one token per interval, never beyond capacity", () => {
    const clock = new FakeClock(NOW);
    const bucket = new TokenBucket(2, 1000, clock);
    bucket.take();
    bucket.take();

    clock.set(NOW + 999);
    expect(bucket.take()).toBe(false);
    clock.set(NOW + 2000);
    expect(bucket.take()).toBe(true);

    clock.set(NOW + 60_000);
    expect([bucket.take(), bucket.take(), bucket.take()]).toEqual([true, true, false]);
  });
});

describe("PersonLimits", () => {
  test("allows ten commands in a burst and refuses the eleventh", () => {
    const limits = new PersonLimits(new FakeClock(NOW));
    const results = Array.from({ length: 11 }, () => limits.allow("ada", "command"));

    expect(results.filter(Boolean)).toHaveLength(10);
    expect(results.at(-1)).toBe(false);
  });

  test("allows six links a minute", () => {
    const clock = new FakeClock(NOW);
    const limits = new PersonLimits(clock);
    const burst = Array.from({ length: 7 }, () => limits.allow("ada", "add"));

    expect(burst.filter(Boolean)).toHaveLength(6);
    clock.set(NOW + 10_000);
    expect(limits.allow("ada", "add")).toBe(true);
  });

  test("keeps separate allowances per person and per kind", () => {
    const limits = new PersonLimits(new FakeClock(NOW));
    for (let i = 0; i < 10; i += 1) limits.allow("ada", "command");

    expect(limits.allow("ada", "command")).toBe(false);
    expect(limits.allow("bob", "command")).toBe(true);
    expect(limits.allow("ada", "ping")).toBe(true);
  });

  test("starts fresh for someone forgotten", () => {
    const limits = new PersonLimits(new FakeClock(NOW));
    for (let i = 0; i < 10; i += 1) limits.allow("ada", "command");

    limits.forget("ada");

    expect(limits.allow("ada", "command")).toBe(true);
  });
});
