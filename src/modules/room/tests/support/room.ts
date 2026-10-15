import type { TrackToQueue } from "@/modules/room/domain/commands.ts";
import { decide, type DecisionContext } from "@/modules/room/domain/decide.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import type { Random } from "@/modules/room/domain/ports/Random.ts";
import type { RoomCommand } from "@/modules/room/domain/commands.ts";
import type { RoomState } from "@/modules/room/domain/RoomState.ts";

export const NOW = 1_760_000_000_000;
export const SONG_MS = 200_000;

/** Always picks the same index — or replays a scripted list of picks. */
export class ScriptedRandom implements Random {
  constructor(private readonly picks: number[] = []) {}

  int(maxExclusive: number): number {
    const pick = this.picks.shift() ?? 0;
    return Math.min(pick, maxExclusive - 1);
  }
}

/** Mulberry32: tiny, seeded, good enough to generate test scenarios reproducibly. */
export class SeededRandom implements Random {
  constructor(private seed: number) {}

  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

let nextEntry = 0;

/** Songs for one person, with unique entry and track ids. */
export function songs(ownerId: string, count: number, durationMs = SONG_MS): TrackToQueue[] {
  return Array.from({ length: count }, () => {
    nextEntry += 1;
    return { entryId: `e${nextEntry}`, trackId: `youtube:${ownerId}-${nextEntry}`, durationMs };
  });
}

export function context(now = NOW, random: Random = new ScriptedRandom()): DecisionContext {
  return { now, random };
}

/** Decides and commits, failing loudly on a rejection the test did not expect. */
export function apply(
  state: RoomState,
  command: RoomCommand,
  now = NOW,
  random?: Random,
): RoomState {
  const decision = decide(state, command, context(now, random));
  if (decision.kind === "rejected") {
    throw new Error(`${command.type} was rejected as ${decision.code}`);
  }
  return commit(state, decision.events);
}

/** The owner of the entry playing now. */
export function playingOwner(state: RoomState): string | null {
  return state.current === null ? null : (state.entries[state.current.entryId]?.ownerId ?? null);
}

/** Lets the current song run to its end and the alarm fire. */
export function finishSong(state: RoomState, now: number): { state: RoomState; now: number } {
  const current = state.current;
  if (current === null) return { state, now };
  const duration = state.entries[current.entryId]?.durationMs ?? 0;
  const endAt = current.anchorAt + duration - current.positionMs + 1000;
  return {
    state: apply(state, { type: "track_ended", entryId: current.entryId }, endAt),
    now: endAt,
  };
}

/** The first three entries in a person's list, failing the test if there are fewer. */
export function firstThree(state: RoomState, ownerId: string): [string, string, string] {
  const [a, b, c] = state.lanes[ownerId] ?? [];
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error(`${ownerId} has fewer than three songs queued.`);
  }
  return [a, b, c];
}
