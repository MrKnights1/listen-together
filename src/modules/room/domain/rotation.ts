import type { RoomState } from "./RoomState.ts";

/**
 * Fair rotation between the people who queued songs.
 *
 * The people waiting form a line, held as rotation keys: lowest goes next.
 * Whoever's song is playing is *out* of the line while it plays, and rejoins
 * at the back only when it ends — so anyone who queued during their song is
 * already ahead of them. Someone adding to an empty list joins at the back,
 * never ahead of people already waiting. Nobody's turn comes twice while
 * somebody else is waiting.
 *
 * Keys come from a counter that only increases, so "the back" is always a
 * number nobody holds yet.
 */

/** Whose song is playing, or null when the room is idle. */
export function ownerOfCurrent(state: RoomState): string | null {
  return state.current === null ? null : (state.entries[state.current.entryId]?.ownerId ?? null);
}

/** Whose turn it is, or null when nobody is waiting. */
export function nextOwner(state: RoomState): string | null {
  let best: string | null = null;
  let bestKey = Infinity;
  for (const [ownerId, key] of Object.entries(state.keys)) {
    if (key < bestKey) {
      best = ownerId;
      bestKey = key;
    }
  }
  return best;
}

/** Puts someone at the back of the line, if they have songs and are not already in it. */
export function joinLine(state: RoomState, ownerId: string): RoomState {
  const lane = state.lanes[ownerId] ?? [];
  if (lane.length === 0 || state.keys[ownerId] !== undefined) return state;

  const counter = state.counter + 1;
  return { ...state, counter, keys: { ...state.keys, [ownerId]: counter } };
}

/**
 * Appends to a person's list. Someone not yet waiting joins at the back of the
 * line — unless their song is the one playing: they rejoin when it ends.
 */
export function appendToLane(state: RoomState, ownerId: string, entryIds: string[]): RoomState {
  if (entryIds.length === 0) return state;

  const room = setLane(state, ownerId, [...(state.lanes[ownerId] ?? []), ...entryIds]);
  return ownerOfCurrent(room) === ownerId ? room : joinLine(room, ownerId);
}

/** Takes the head of a person's list for their turn. They leave the line while it plays. */
export function takeTurn(state: RoomState, ownerId: string): { state: RoomState; entryId: string } {
  const [entryId, ...rest] = state.lanes[ownerId] ?? [];
  if (entryId === undefined) throw new Error(`${ownerId} has nothing queued.`);

  const keys = { ...state.keys };
  delete keys[ownerId];
  return { entryId, state: setLane({ ...state, keys }, ownerId, rest) };
}

/** Drops a queued entry from its list. Nobody's place in line changes. */
export function removeFromLane(state: RoomState, ownerId: string, entryId: string): RoomState {
  return setLane(
    state,
    ownerId,
    (state.lanes[ownerId] ?? []).filter((id) => id !== entryId),
  );
}

/**
 * Replaces a person's list, keeping their place in line. An emptied list is
 * removed together with its place: nobody waits in line with nothing to play.
 */
export function setLane(state: RoomState, ownerId: string, lane: string[]): RoomState {
  const lanes = { ...state.lanes };
  if (lane.length > 0) {
    lanes[ownerId] = lane;
    return { ...state, lanes };
  }

  delete lanes[ownerId];
  const keys = { ...state.keys };
  delete keys[ownerId];
  return { ...state, lanes, keys };
}
