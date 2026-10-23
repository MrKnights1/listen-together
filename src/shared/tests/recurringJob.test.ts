import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Timers } from "@/shared/domain/Timers.ts";
import { RecurringJob } from "@/shared/infrastructure/RecurringJob.ts";

/** An interval that fires only when the test says so. */
class TickOnDemand implements Timers {
  private ticks: (() => void | Promise<void>)[] = [];

  every(_milliseconds: number, tick: () => void | Promise<void>): () => void {
    this.ticks.push(tick);
    return () => {
      this.ticks = this.ticks.filter((one) => one !== tick);
    };
  }

  after(): () => void {
    throw new Error("RecurringJob schedules with every()");
  }

  get armed(): number {
    return this.ticks.length;
  }

  async tick(): Promise<void> {
    await Promise.all(this.ticks.map((tick) => tick()));
  }
}

/** A pass that stays running until the test lets it finish. */
function heldPasses() {
  let started = 0;
  let finish: () => void = () => undefined;
  const run = () => {
    started += 1;
    return new Promise<void>((resolve) => (finish = resolve));
  };
  return { run, finish: () => finish(), started: () => started };
}

const errors = spyOn(console, "error").mockImplementation(() => undefined);
afterEach(() => errors.mockClear());
afterAll(() => errors.mockRestore());

describe("RecurringJob", () => {
  test("arms its schedule at once and does not hold the caller up for the first pass", async () => {
    const timers = new TickOnDemand();
    const passes = heldPasses();
    const job = new RecurringJob("Tidying", 1000, passes.run, timers);

    const first = job.start();
    let firstDone = false;
    void first.then(() => (firstDone = true));
    await Promise.resolve();

    expect(passes.started()).toBe(1);
    expect(timers.armed).toBe(1);
    expect(firstDone).toBe(false);

    passes.finish();
    await first;
    expect(firstDone).toBe(true);
  });

  test("never starts a pass while the one before is still running", async () => {
    const timers = new TickOnDemand();
    const passes = heldPasses();
    const job = new RecurringJob("Tidying", 1000, passes.run, timers);

    const first = job.start();
    const tick = timers.tick();
    expect(passes.started()).toBe(1);

    passes.finish();
    await Promise.all([first, tick]);
    const next = timers.tick();
    expect(passes.started()).toBe(2);
    passes.finish();
    await next;
  });

  test("logs a failed pass and still runs the next one", async () => {
    const timers = new TickOnDemand();
    let runs = 0;
    const job = new RecurringJob(
      "Tidying",
      1000,
      async () => {
        runs += 1;
        if (runs === 1) throw new Error("YouTube is down");
      },
      timers,
    );

    await job.start();
    await timers.tick();

    expect(runs).toBe(2);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]?.[0])).toBe("Tidying failed");
  });

  test("runs nothing more once stopped", async () => {
    const timers = new TickOnDemand();
    let runs = 0;
    const job = new RecurringJob("Tidying", 1000, async () => void (runs += 1), timers);

    await job.start();
    job.stop();
    await timers.tick();

    expect(runs).toBe(1);
    expect(timers.armed).toBe(0);
  });
});
