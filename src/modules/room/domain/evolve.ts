import type { RoomEvent } from "./events.ts";
import {
  appendToLane,
  joinLine,
  nextOwner,
  removeFromLane,
  setLane,
  takeTurn,
} from "./rotation.ts";
import type { RoomState } from "./RoomState.ts";

function withoutEntry(state: RoomState, entryId: string): RoomState {
  const entries = { ...state.entries };
  delete entries[entryId];
  return { ...state, entries };
}

/**
 * Moves the room on from its current song: replay it, re-queue it, or drop
 * it; send its owner to the back of the line; then start whoever's turn it is.
 * A paused room stays paused on the next song — somebody paused it, and
 * skipping is not a reason to start playing.
 */
function advance(state: RoomState, reason: RoomEvent & { type: "advanced" }): RoomState {
  const current = state.current;
  let room = state;

  if (current !== null) {
    const entry = state.entries[current.entryId];
    if (entry === undefined) throw new Error(`The current entry ${current.entryId} is missing.`);

    // Replaying is not a new turn: nobody's place in line moves.
    if (reason.reason === "ended" && state.repeat === "one") {
      return {
        ...state,
        current: { ...current, status: "playing", positionMs: 0, anchorAt: reason.at },
      };
    }

    room =
      state.repeat === "all" && reason.reason !== "removed"
        ? appendToLane(room, entry.ownerId, [entry.id])
        : withoutEntry(room, entry.id);
    // Their song is over: they rejoin at the back, behind anyone who queued during it.
    room = joinLine({ ...room, current: null }, entry.ownerId);
  }

  const status = current?.status === "paused" && reason.reason !== "ended" ? "paused" : "playing";
  const owner = nextOwner(room);
  if (owner === null) return { ...room, current: null };

  const turn = takeTurn(room, owner);
  return {
    ...turn.state,
    current: { entryId: turn.entryId, status, positionMs: 0, anchorAt: reason.at },
  };
}

/** Applies one event. Pure: the same state and event always give the same room. */
export function evolve(state: RoomState, event: RoomEvent): RoomState {
  switch (event.type) {
    case "queued": {
      let room: RoomState = {
        ...state,
        entries: { ...state.entries, ...Object.fromEntries(event.entries.map((e) => [e.id, e])) },
      };
      for (const entry of event.entries) room = appendToLane(room, entry.ownerId, [entry.id]);
      return room;
    }

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

    case "removed": {
      const entry = state.entries[event.entryId];
      if (entry === undefined) return state;
      return withoutEntry(removeFromLane(state, entry.ownerId, entry.id), entry.id);
    }

    case "moved": {
      const entry = state.entries[event.entryId];
      if (entry === undefined) return state;
      const lane = (state.lanes[entry.ownerId] ?? []).filter((id) => id !== entry.id);
      lane.splice(event.toIndex, 0, entry.id);
      return setLane(state, entry.ownerId, lane);
    }

    case "shuffled": {
      let room = state;
      for (const [ownerId, lane] of Object.entries(event.lanes))
        room = setLane(room, ownerId, lane);
      return room;
    }

    case "repeat_set":
      return { ...state, repeat: event.mode };
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
