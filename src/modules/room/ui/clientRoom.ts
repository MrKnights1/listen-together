import type { ListenerView, Person, ServerMessage } from "@/modules/room/contract/messages.ts";
import type { ActivityEntry } from "@/modules/room/domain/activity.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";

/** How many feed lines a page keeps. */
const FEED_LENGTH = 50;

/** The room as this browser knows it. */
export interface ClientRoom {
  /** Null until the server's welcome: nothing is shown or applied before it. */
  you: string | null;
  state: RoomState;
  tracks: Record<string, TrackInfo>;
  people: Record<string, Person>;
  activity: ActivityEntry[];
  listeners: ListenerView[];
  /** A version was skipped: this copy is behind and the whole room must be asked for again. */
  behind: boolean;
}

export function emptyClientRoom(): ClientRoom {
  return {
    you: null,
    state: emptyRoom(),
    tracks: {},
    people: {},
    activity: [],
    listeners: [],
    behind: false,
  };
}

const byKey = <T>(items: T[], key: (item: T) => string): Record<string, T> =>
  Object.fromEntries(items.map((item) => [key(item), item]));

/**
 * The people known, with these added or updated. The same object back when
 * nothing changed, so what is drawn from it is not redrawn for nothing.
 */
function withPeople(known: Record<string, Person>, people: Person[]): Record<string, Person> {
  const changed = people.filter((person) => {
    const before = known[person.id];
    return before?.name !== person.name || before.avatarUrl !== person.avatarUrl;
  });
  return changed.length === 0 ? known : { ...known, ...byKey(changed, (person) => person.id) };
}

/**
 * Folds one message from the server into this browser's copy of the room.
 * Changes arrive as the same events the server applied, and are applied here
 * by the same `evolve` — so the two copies cannot disagree about what a pause
 * or a skip means, only about whether a message arrived.
 */
export function receive(room: ClientRoom, message: ServerMessage): ClientRoom {
  switch (message.t) {
    case "welcome":
    case "snapshot":
      return {
        you: message.t === "welcome" ? message.you : room.you,
        state: message.room.state,
        tracks: byKey(message.room.tracks, (track) => track.trackId),
        people: withPeople(room.people, message.room.people),
        activity: message.room.activity.slice(-FEED_LENGTH),
        listeners: message.listeners,
        behind: false,
      };

    case "ev": {
      if (room.you === null || message.v <= room.state.version) return room;
      if (message.v !== room.state.version + 1) return { ...room, behind: true };

      return {
        ...room,
        state: commit(room.state, message.events),
        tracks:
          message.tracks.length === 0
            ? room.tracks
            : { ...room.tracks, ...byKey(message.tracks, (track) => track.trackId) },
        activity:
          message.activity === null
            ? room.activity
            : [...room.activity, message.activity].slice(-FEED_LENGTH),
      };
    }

    case "listeners":
      return {
        ...room,
        listeners: message.listeners,
        people: withPeople(room.people, message.people),
      };

    case "pong":
    case "ack":
    case "nack":
      return room;
  }
}
