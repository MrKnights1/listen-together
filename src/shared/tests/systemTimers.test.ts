import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { MAX_TIMEOUT_MS, SystemTimers } from "@/shared/infrastructure/SystemTimers.ts";

/**
 * Fake timers are the clock boundary, not the code under test: SystemTimers is
 * the real implementation, driven by a clock we can advance.
 */
let timers: SystemTimers;

beforeEach(() => {
  jest.useFakeTimers();
  timers = new SystemTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Lets the guarded async wrapper around a fired task run to completion. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("SystemTimers.after", () => {
  test("fires once, when the delay has passed", async () => {
    let fired = 0;
    timers.after(1000, () => {
      fired++;
    });

    jest.advanceTimersByTime(999);
    await settle();
    expect(fired).toBe(0);

    jest.advanceTimersByTime(1);
    await settle();
    expect(fired).toBe(1);

    jest.advanceTimersByTime(10_000);
    await settle();
    expect(fired).toBe(1);
  });

  /**
   * The regression this class exists to prevent: a bare setTimeout with a 30-day
   * delay overflows and fires after a millisecond.
   */
  test("does not fire early for a delay past the 2^31 ms setTimeout cap", async () => {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(thirtyDays).toBeGreaterThan(MAX_TIMEOUT_MS);

    let fired = 0;
    timers.after(thirtyDays, () => {
      fired++;
    });

    jest.advanceTimersByTime(1);
    await settle();
    expect(fired).toBe(0);

    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    await settle();
    expect(fired).toBe(0);

    jest.advanceTimersByTime(thirtyDays - MAX_TIMEOUT_MS - 2);
    await settle();
    expect(fired).toBe(0);

    jest.advanceTimersByTime(1);
    await settle();
    expect(fired).toBe(1);
  });

  test("never fires once cancelled, even in a later hop of a long delay", async () => {
    let fired = 0;
    const cancel = timers.after(MAX_TIMEOUT_MS + 5000, () => {
      fired++;
    });

    jest.advanceTimersByTime(MAX_TIMEOUT_MS);
    cancel();
    jest.advanceTimersByTime(10_000);
    await settle();

    expect(fired).toBe(0);
  });

  test("fires straight away for a delay already in the past", async () => {
    let fired = 0;
    timers.after(-50, () => {
      fired++;
    });

    jest.advanceTimersByTime(0);
    await settle();

    expect(fired).toBe(1);
  });

  test("survives a task that throws, without an unhandled rejection", async () => {
    const reported: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      reported.push(args);
    };

    try {
      timers.after(10, () => {
        throw new Error("boom");
      });
      jest.advanceTimersByTime(10);
      await settle();
    } finally {
      console.error = original;
    }

    expect(reported).toHaveLength(1);
  });
});

describe("SystemTimers.every", () => {
  test("ticks on every interval until stopped", async () => {
    let ticks = 0;
    const stop = timers.every(100, () => {
      ticks++;
    });

    jest.advanceTimersByTime(350);
    await settle();
    expect(ticks).toBe(3);

    stop();
    jest.advanceTimersByTime(1000);
    await settle();
    expect(ticks).toBe(3);
  });
});
