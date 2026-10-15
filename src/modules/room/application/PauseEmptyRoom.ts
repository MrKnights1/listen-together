import type { Timers } from "@/shared/domain/Timers.ts";
import { EMPTY_ROOM_PAUSE_MS } from "@/modules/room/domain/limits.ts";
import type { RoomEngine } from "./RoomEngine.ts";

/**
 * Pauses the room once nobody has been listening for a minute, so songs do
 * not quietly play out to an empty room and the queue is still there when
 * people come back. A minute, not at once: reloading the page should not
 * pause everybody else.
 */
export class PauseEmptyRoom {
  private cancel: (() => void) | null = null;

  constructor(
    private readonly engine: RoomEngine,
    private readonly timers: Timers,
  ) {}

  listenersChanged(count: number): void {
    if (count > 0) {
      this.stop();
      return;
    }
    if (this.cancel !== null) return;

    this.cancel = this.timers.after(EMPTY_ROOM_PAUSE_MS, async () => {
      this.cancel = null;
      await this.engine.execute({ type: "auto_pause" }, null, []);
    });
  }

  stop(): void {
    this.cancel?.();
    this.cancel = null;
  }
}
