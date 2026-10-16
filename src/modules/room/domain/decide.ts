import type { RoomCommand, TrackToQueue } from "./commands.ts";
import type { AdvanceReason, RoomEvent } from "./events.ts";
import { MAX_ROOM_ENTRIES } from "./limits.ts";
import { positionAt } from "./playback.ts";
import type { Random } from "./ports/Random.ts";
import { queuedBy, queuedUpTo, queueIndex, type QueueEntry, type RoomState } from "./RoomState.ts";

/**
 * `stale`: the command named a song that is no longer where the sender saw
 * it. `invalid`: the command can never apply, e.g. moving the song playing.
 */
export type RejectionCode = "stale" | "invalid";

/** What an `add` did with each song it was given. */
export interface AddOutcome {
  added: string[];
  /** Track ids already queued by this person, or playing right now. */
  duplicates: string[];
  /** How many were left out because the room was full. */
  overflow: number;
}

export type Decision =
  | { kind: "accepted"; events: RoomEvent[]; add?: AddOutcome }
  | { kind: "rejected"; code: RejectionCode };

export interface DecisionContext {
  now: number;
  random: Random;
}

const accepted = (events: RoomEvent[]): Decision => ({ kind: "accepted", events });
const rejected = (code: RejectionCode): Decision => ({ kind: "rejected", code });

/** True when the command names the song everybody is on right now. */
function isCurrent(state: RoomState, entryId: string): boolean {
  return state.current?.entryId === entryId;
}

/**
 * The entry the room moves on to: the top of `queue`, or with shuffle on any
 * of it at random. Repeat-one replays the song that ended. Repeat-all puts the
 * song that played back at the end of the queue, but picks it again only when
 * nothing else waits — so shuffle never plays one song twice in a row.
 */
function nextUp(
  state: RoomState,
  reason: AdvanceReason,
  random: Random,
  queue: string[],
): string | null {
  const current = state.current;
  if (current !== null && reason === "ended" && state.repeat === "one") return current.entryId;
  if (queue.length > 0) return (state.shuffle ? queue[random.int(queue.length)] : queue[0]) ?? null;
  return current !== null && state.repeat === "all" && reason !== "removed"
    ? current.entryId
    : null;
}

/** Moving on, with the next song chosen now so every fold of the event plays the same one. */
function moveOn(
  state: RoomState,
  reason: AdvanceReason,
  context: DecisionContext,
  queue = state.queue,
): RoomEvent {
  return {
    type: "advanced",
    reason,
    next: nextUp(state, reason, context.random, queue),
    at: context.now,
  };
}

function decideAdd(
  state: RoomState,
  ownerId: string,
  tracks: TrackToQueue[],
  context: DecisionContext,
): Decision {
  const { now } = context;
  const theirs = queuedBy(state, ownerId);
  const taken = new Set(theirs.map((id) => state.entries[id]?.trackId));
  const playing = state.current === null ? undefined : state.entries[state.current.entryId];
  if (playing !== undefined) taken.add(playing.trackId);

  let room = MAX_ROOM_ENTRIES - Object.keys(state.entries).length;
  const entries: QueueEntry[] = [];
  const duplicates: string[] = [];
  let overflow = 0;

  for (const track of tracks) {
    if (taken.has(track.trackId)) {
      duplicates.push(track.trackId);
    } else if (room <= 0) {
      overflow += 1;
    } else {
      taken.add(track.trackId);
      entries.push({
        id: track.entryId,
        ownerId,
        trackId: track.trackId,
        durationMs: track.durationMs,
        addedAt: now,
      });
      room -= 1;
    }
  }

  const events: RoomEvent[] = entries.length === 0 ? [] : [{ type: "queued", entries }];
  // An idle room starts on its own the moment there is something to play.
  if (entries.length > 0 && state.current === null) {
    events.push(
      moveOn(state, "started", context, [...state.queue, ...entries.map((entry) => entry.id)]),
    );
  }

  return {
    kind: "accepted",
    events,
    add: { added: entries.map((entry) => entry.id), duplicates, overflow },
  };
}

/** Fisher–Yates over a copy: every order equally likely, given a fair `Random`. */
function shuffled(entryIds: string[], random: Random): string[] {
  const copy = [...entryIds];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = random.int(index + 1);
    [copy[index], copy[other]] = [copy[other] as string, copy[index] as string];
  }
  return copy;
}

/**
 * Shuffles one person's songs among the places they already hold — so
 * shuffling your own songs never moves anybody else's.
 */
function shuffleQueue(state: RoomState, ownerId: string, random: Random): string[] {
  const mixed = shuffled(queuedBy(state, ownerId), random);
  return state.queue.map((entryId) =>
    state.entries[entryId]?.ownerId === ownerId ? (mixed.shift() ?? entryId) : entryId,
  );
}

/**
 * Decides what a command does to the room, without changing it. Pure: the
 * clock and chance arrive in `context`, so every outcome can be tested by
 * choosing them.
 */
export function decide(state: RoomState, command: RoomCommand, context: DecisionContext): Decision {
  const { now } = context;

  switch (command.type) {
    case "add":
      return decideAdd(state, command.ownerId, command.tracks, context);

    case "pause":
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      if (state.current?.status === "paused") return accepted([]);
      return accepted([{ type: "paused", positionMs: positionAt(state, now), at: now }]);

    case "resume":
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      if (state.current?.status === "playing") return accepted([]);
      return accepted([{ type: "resumed", at: now }]);

    case "seek": {
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      if (!Number.isFinite(command.positionMs)) return rejected("invalid");
      const durationMs = state.entries[command.entryId]?.durationMs ?? 0;
      const positionMs = Math.round(Math.min(Math.max(command.positionMs, 0), durationMs));
      return accepted([{ type: "seeked", positionMs, at: now }]);
    }

    case "skip":
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      return accepted([moveOn(state, "skipped", context)]);

    case "remove":
      if (isCurrent(state, command.entryId)) {
        return accepted([moveOn(state, "removed", context)]);
      }
      if (queueIndex(state, command.entryId) === -1) return rejected("stale");
      return accepted([{ type: "removed", entryId: command.entryId }]);

    case "move": {
      if (isCurrent(state, command.entryId)) return rejected("invalid");
      if (!Number.isInteger(command.toIndex)) return rejected("invalid");
      const fromIndex = queueIndex(state, command.entryId);
      if (fromIndex === -1) return rejected("stale");
      const toIndex = Math.min(Math.max(command.toIndex, 0), state.queue.length - 1);
      if (toIndex === fromIndex) return accepted([]);
      return accepted([{ type: "moved", entryId: command.entryId, toIndex }]);
    }

    case "clear": {
      if (!Number.isFinite(command.addedUpTo)) return rejected("invalid");
      const entryIds = queuedUpTo(state, command.addedUpTo);
      return entryIds.length === 0 ? accepted([]) : accepted([{ type: "cleared", entryIds }]);
    }

    case "shuffle": {
      const queue = shuffleQueue(state, command.ownerId, context.random);
      return queue.every((entryId, index) => entryId === state.queue[index])
        ? accepted([])
        : accepted([{ type: "shuffled", queue }]);
    }

    case "repeat":
      return state.repeat === command.mode
        ? accepted([])
        : accepted([{ type: "repeat_set", mode: command.mode }]);

    case "set_shuffle":
      return state.shuffle === command.on
        ? accepted([])
        : accepted([{ type: "shuffle_set", on: command.on }]);

    case "track_ended":
      // The alarm is re-armed after every command, but a stale one must still
      // never cut a song short: it has only ended if the clock says so.
      if (!isCurrent(state, command.entryId) || state.current?.status !== "playing") {
        return rejected("stale");
      }
      if (positionAt(state, now) < (state.entries[command.entryId]?.durationMs ?? 0)) {
        return rejected("stale");
      }
      return accepted([moveOn(state, "ended", context)]);

    case "auto_pause":
      if (state.current?.status !== "playing") return accepted([]);
      return accepted([{ type: "paused", positionMs: positionAt(state, now), at: now }]);
  }
}
