import type { ProviderId } from "@/shared/domain/TrackRef.ts";
import type { PlayerState } from "./PlayerAdapter.ts";

/** Where the room says this listener should be, right now. */
export interface Target {
  provider: ProviderId;
  providerTrackId: string;
  playing: boolean;
  /** The room's position at the instant the target was computed. */
  positionMs: number;
  durationMs: number;
  /**
   * When the room last set where it is — a jump, a pause, a resume or a new
   * song — on the room's clock. A new value is an instruction, not drift.
   */
  setAt: number;
}

/** What the local player is doing, read at the same instant. */
export interface PlayerView {
  providerTrackId: string | null;
  state: PlayerState;
  positionMs: number;
  /** The provider error for the loaded track, if it refused to play. */
  error: number | null;
}

export type SyncStatus =
  | "idle"
  | "in_sync"
  | "catching_up"
  | "out_of_sync"
  | "error"
  /** The provider's player itself could not be loaded on this page. */
  | "no_player";

export type PlayerAction =
  | { type: "load"; provider: ProviderId; providerTrackId: string; startMs: number; play: boolean }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; positionMs: number };

/** What reconcile remembers between ticks. */
export interface SyncMemory {
  lastCorrectionAt: number | null;
  failures: number;
  lastPositionMs: number | null;
  stalledSince: number | null;
  /** The room's last instruction this player has taken in: `Target.setAt`. */
  followedSetAt: number | null;
}

export const freshMemory = (): SyncMemory => ({
  lastCorrectionAt: null,
  failures: 0,
  lastPositionMs: null,
  stalledSince: null,
  followedSetAt: null,
});

/** Under a second apart is not worth an audible jump. */
export const IN_SYNC_MS = 1000;
/** A paused player should sit where the room is paused, near enough to resume together. */
export const PAUSED_ALIGN_MS = 250;
/** Seeks and loads land a little ahead, to cover the time they take. */
export const SEEK_LEAD_MS = 200;
export const LOAD_LEAD_MS = 500;
/** After a correction, wait this long before judging it; doubled per failed correction. */
export const CORRECTION_COOLDOWN_MS = 5000;
export const MAX_COOLDOWN_MS = 40_000;
/** This many corrections in a row without landing, and the listener is out of sync. */
export const OUT_OF_SYNC_AFTER = 3;
/** "Playing" without moving for this long is an ad or a stall, not drift. */
export const STALL_MS = 2000;
/** A player that ended within this of the song's end is just ahead of the room's grace second. */
export const END_TOLERANCE_MS = 2000;

const result = (actions: PlayerAction[], memory: SyncMemory, status: SyncStatus) => ({
  actions,
  memory,
  status,
});

const sounding = (state: PlayerState) => state === "playing" || state === "buffering";

/**
 * One step of keeping this browser's player on the room's timeline. Pure:
 * given where the room is, what the player is doing and what it remembers,
 * it says what to do next. Called about once a second, and again whenever
 * the room changes.
 */
export function reconcile(
  target: Target | null,
  player: PlayerView,
  listening: boolean,
  known: SyncMemory,
  now: number,
): { actions: PlayerAction[]; memory: SyncMemory; status: SyncStatus } {
  if (!listening || target === null) {
    return result(sounding(player.state) ? [{ type: "pause" }] : [], freshMemory(), "idle");
  }

  // The room jumped, paused, resumed or moved on: an instruction, followed at once. The
  // cooldown is for this player's own drift, and must never hold back what the room did.
  const fresh: SyncMemory = { ...freshMemory(), followedSetAt: target.setAt };
  const memory = known.followedSetAt === target.setAt ? known : fresh;

  if (player.providerTrackId !== target.providerTrackId) {
    const lead = target.playing ? LOAD_LEAD_MS : 0;
    return result(
      [
        {
          type: "load",
          provider: target.provider,
          providerTrackId: target.providerTrackId,
          startMs: Math.min(target.positionMs + lead, target.durationMs),
          play: target.playing,
        },
      ],
      { ...fresh, lastCorrectionAt: now },
      "catching_up",
    );
  }

  // This listener's player refused the song. Their problem alone: never skip for everyone.
  if (player.error !== null) return result([], memory, "error");

  const drift = player.positionMs - target.positionMs;

  if (!target.playing) {
    const actions: PlayerAction[] = [];
    if (sounding(player.state)) actions.push({ type: "pause" });
    if (Math.abs(drift) > PAUSED_ALIGN_MS)
      actions.push({ type: "seek", positionMs: target.positionMs });
    return result(actions, fresh, "in_sync");
  }

  // Finished a beat before the room moved on: that is the grace second, not a fault.
  if (player.state === "ended" && target.positionMs >= target.durationMs - END_TOLERANCE_MS) {
    return result([], { ...memory, lastPositionMs: player.positionMs }, "in_sync");
  }

  if (!sounding(player.state)) {
    const actions: PlayerAction[] = [{ type: "play" }];
    if (Math.abs(drift) > IN_SYNC_MS) {
      actions.unshift({ type: "seek", positionMs: target.positionMs + SEEK_LEAD_MS });
    }
    return result(
      actions,
      { ...memory, lastCorrectionAt: now, lastPositionMs: null, stalledSince: null },
      "catching_up",
    );
  }

  // Playing but not moving: an ad, or buffering. Seeking would only fight it.
  const moved =
    memory.lastPositionMs === null || Math.abs(player.positionMs - memory.lastPositionMs) > 50;
  const stalledSince = moved ? null : (memory.stalledSince ?? now);
  const watching = { ...memory, lastPositionMs: player.positionMs, stalledSince };
  if (player.state === "buffering" || (stalledSince !== null && now - stalledSince >= STALL_MS)) {
    return result([], watching, "catching_up");
  }

  if (Math.abs(drift) <= IN_SYNC_MS) {
    return result([], { ...watching, failures: 0, lastCorrectionAt: null }, "in_sync");
  }

  const cooldown = Math.min(CORRECTION_COOLDOWN_MS * 2 ** memory.failures, MAX_COOLDOWN_MS);
  const waiting = memory.lastCorrectionAt !== null && now - memory.lastCorrectionAt < cooldown;
  const lost = memory.failures >= OUT_OF_SYNC_AFTER;
  if (waiting) return result([], watching, lost ? "out_of_sync" : "catching_up");

  const failures = memory.lastCorrectionAt === null ? memory.failures : memory.failures + 1;
  return result(
    [{ type: "seek", positionMs: target.positionMs + SEEK_LEAD_MS }],
    { ...watching, lastCorrectionAt: now, failures },
    failures >= OUT_OF_SYNC_AFTER ? "out_of_sync" : "catching_up",
  );
}
