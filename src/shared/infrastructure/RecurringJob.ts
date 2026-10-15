import type { Timers } from "@/shared/domain/Timers.ts";

/**
 * Housekeeping that runs on a schedule.
 *
 * Runs once at startup as well as on the interval: a job with a six-hour period
 * on a server that restarts every few hours would otherwise never run at all.
 */
export class RecurringJob {
  private cancel: (() => void) | null = null;

  constructor(
    private readonly name: string,
    private readonly everyMs: number,
    private readonly run: () => Promise<unknown>,
    private readonly timers: Timers,
  ) {}

  async start(): Promise<void> {
    await this.runOnce();
    this.cancel = this.timers.every(this.everyMs, () => this.runOnce());
  }

  private async runOnce(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      // Housekeeping failing is not a reason to stop housekeeping.
      console.error(`${this.name} failed`, error);
    }
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
