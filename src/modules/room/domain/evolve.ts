import type { RoomEvent } from "./events.ts";
import type { RoomState } from "./RoomState.ts";

function withoutEntry(state: RoomState, entryId: string): RoomState {
  const entries = { ...state.entries };
  delete entries[entryId];
  return { ...state, entries };
}

/**
 * Moves the room on from its current song: replay it, re-queue it at the end,
 * or drop it; then start the song the event names. A paused room stays paused
 * on the next song — somebody paused it, and skipping is not a reason to start
 * playing.
 */
function advance(state: RoomState, reason: RoomEvent & { type: "advanced" }): RoomState {
  const current = state.current;
  let room = state;

  if (current !== null) {
    if (state.entries[current.entryId] === undefined) {
      throw new Error(`The current entry ${current.entryId} is missing.`);
    }

    if (reason.reason === "ended" && state.repeat === "one") {
      return {
        ...state,
        current: { ...current, status: "playing", positionMs: 0, anchorAt: reason.at },
      };
    }

    room =
      state.repeat === "all" && reason.reason !== "removed"
        ? { ...room, queue: [...room.queue, current.entryId] }
        : withoutEntry(room, current.entryId);
  }

  const status = current?.status === "paused" && reason.reason !== "ended" ? "paused" : "playing";
  const next = reason.next;
  if (next === null) return { ...room, current: null };
  if (!room.queue.includes(next)) throw new Error(`The next entry ${next} is not queued.`);

  return {
    ...room,
    queue: room.queue.filter((entryId) => entryId !== next),
    current: { entryId: next, status, positionMs: 0, anchorAt: reason.at },
  };
}

/** Applies one event. Pure: the same state and event always give the same room. */
export function evolve(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case "queued":
      return {
        ...state,
        entries: { ...state.entries, ...Object.fromEntries(event.entries.map((e) => [e.id, e])) },
        queue: [...state.queue, ...event.entries.map((entry) => entry.id)],
      };

    case "advanced":
      return advance(state, event);

    case "paused":
      return state.current === null
        ? state
        : {
            ...state,
            current: {
              ...state.current,
              status: "paused",
              positionMs: event.positionMs,
              anchorAt: event.at,
            },
          };

    case "resumed":
      return state.current === null
        ? state
        : { ...state, current: { ...state.current, status: "playing", anchorAt: event.at } };

    case "seeked":
      return state.current === null
        ? state
        : {
            ...state,
            current: { ...state.current, positionMs: event.positionMs, anchorAt: event.at },
          };

    case "removed":
      if (state.entries[event.entryId] === undefined) return state;
      return withoutEntry(
        { ...state, queue: state.queue.filter((id) => id !== event.entryId) },
        event.entryId,
      );

    case "moved": {
      if (!state.queue.includes(event.entryId)) return state;
      const queue = state.queue.filter((id) => id !== event.entryId);
      queue.splice(event.toIndex, 0, event.entryId);
      return { ...state, queue };
    }

    case "shuffled":
      return { ...state, queue: event.queue };

    case "repeat_set":
      return { ...state, repeat: event.mode };

    case "shuffle_set":
      return { ...state, shuffle: event.on };
  }
}

/**
 * Applies the events of one command and counts it. A command that changed
 * nothing produces no events and leaves the version alone, so a browser is
 * never told to expect an update that does not exist.
 */
export function commit(state: RoomState, events: RoomEvent[]): RoomState {
  if (events.length === 0) return state;
  return { ...events.reduce(evolve, state), version: state.version + 1 };
}
