import type { RoomEvent } from "./events.ts";
import { MIN_PLAYED_MS, RECENTLY_PLAYED } from "./limits.ts";
import { positionAt } from "./playback.ts";
import type { PlayedSong, RoomState } from "./RoomState.ts";

/**
 * Recently played once the room moves on from its song, read from the room
 * before it does. A song counts when it ended, or was skipped once heard; a
 * song removed was not played. Played again, it moves to the top.
 */
export function rememberPlayed(
  state: RoomState,
  event: RoomEvent & { type: "advanced" },
): PlayedSong[] {
  const current = state.current;
  const entry = current === null ? undefined : state.entries[current.entryId];
  if (entry === undefined) return state.played;

  const heard =
    event.reason === "ended" ||
    (event.reason === "skipped" && positionAt(state, event.at) >= MIN_PLAYED_MS);
  if (!heard) return state.played;

  const song: PlayedSong = { trackId: entry.trackId, ownerId: entry.ownerId, at: event.at };
  return [song, ...state.played.filter((one) => one.trackId !== entry.trackId)].slice(
    0,
    RECENTLY_PLAYED,
  );
}
