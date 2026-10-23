import type { Timers } from "@/shared/domain/Timers.ts";

/**
 * Housekeeping that runs on a schedule.
 *
 * Runs once at startup as well as on the interval: a job with a six-hour period
 * on a server that restarts every few hours would otherwise never run at all.
 * A pass never overlaps the one before it.
 */
export class RecurringJob {
  private cancel: (() => void) | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    private readonly everyMs: number,
    private readonly run: () => Promise<unknown>,
    private readonly timers: Timers,
  ) {}

  /**
   * Arms the schedule and starts the first pass without waiting for it: a pass
   * may wait on outside services, and the caller must not. Resolves when that
   * first pass is over; never rejects.
   */
  start(): Promise<void> {
    this.cancel = this.timers.every(this.everyMs, () => this.runOnce());
    return this.runOnce();
  }

  private runOnce(): Promise<void> {
    if (this.running !== null) return this.running;
    this.running = this.run()
      .then(
        () => undefined,
        (error: unknown) => {
          // Housekeeping failing is not a reason to stop housekeeping.
          console.error(`${this.name} failed`, error);
        },
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  /** Stops future passes. One in flight is left to finish or be cut off by exit. */
  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
