import type { Timers } from "@/shared/domain/Timers.ts";

/**
 * The longest delay `setTimeout` honours. Anything larger overflows a signed
 * 32-bit integer and fires almost immediately — a 30-day session alarm would go
 * off after a millisecond and log everybody out.
 */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** A rejected tick must not surface as an unhandled rejection and kill the process. */
function guarded(task: () => void | Promise<void>, label: string): () => void {
  return () => {
    void (async () => {
      try {
        await task();
      } catch (error) {
        console.error(label, error);
      }
    })();
  };
}

export class SystemTimers implements Timers {
  every(milliseconds: number, tick: () => void | Promise<void>): () => void {
    const handle = setInterval(guarded(tick, "A scheduled tick failed"), milliseconds);

    // Without this a pending interval keeps the process alive through what
    // should be a clean exit.
    handle.unref?.();

    return () => clearInterval(handle);
  }

  after(milliseconds: number, fire: () => void | Promise<void>): () => void {
    const run = guarded(fire, "A scheduled task failed");
    let handle: ReturnType<typeof setTimeout> | null = null;

    // Long delays are walked in legal-sized hops, each re-arming the next.
    const arm = (remaining: number): void => {
      const hop = Math.min(Math.max(remaining, 0), MAX_TIMEOUT_MS);
      handle = setTimeout(() => {
        const left = remaining - hop;
        if (left > 0) arm(left);
        else {
          handle = null;
          run();
        }
      }, hop);
      handle.unref?.();
    };

    arm(milliseconds);

    return () => {
      if (handle !== null) clearTimeout(handle);
      handle = null;
    };
  }
}
