import type { ActivityEntry } from "@/modules/room/domain/activity.ts";
import type { Person } from "@/modules/room/domain/Person.ts";
import type { RoomEvent } from "@/modules/room/domain/events.ts";
import type { RepeatMode, RoomState } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";

/**
 * The room's wire protocol, shared verbatim by the server and the browser so
 * the two cannot drift. Pure types and constants: nothing here may reach a
 * database, a socket or the DOM.
 */

export type { Person };

/** Bigger than any honest message — a pasted link is the largest — and small enough to refuse junk early. */
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_URL_LENGTH = 2048;
export const MAX_ID_LENGTH = 64;
/** A day: no song is longer, and anything beyond it is not a position. */
export const MAX_POSITION_MS = 86_400_000;

/** How a listener's player is doing, as their browser reports it. */
export type SyncStatus = "idle" | "in_sync" | "catching_up" | "out_of_sync" | "error";

export interface ListenerView {
  userId: string;
  listening: boolean;
  sync: SyncStatus;
  /** The YouTube player error code behind `error`, so the room can say "can't play this". */
  errorCode: number | null;
}

export interface RoomSnapshot {
  state: RoomState;
  tracks: TrackInfo[];
  activity: ActivityEntry[];
  people: Person[];
}

export type CommandOp =
  | { type: "add"; url: string }
  | { type: "pause" | "resume" | "skip" | "remove"; entryId: string }
  | { type: "seek"; entryId: string; positionMs: number }
  | { type: "move"; entryId: string; toIndex: number }
  | { type: "shuffle"; ownerId: string | null }
  | { type: "repeat"; mode: RepeatMode };

export type ClientMessage =
  /** `c` is the browser's own clock when it sent this, echoed back to measure the round trip. */
  | { t: "ping"; id: number; c: number }
  | { t: "cmd"; id: string; op: CommandOp }
  | { t: "resync" }
  | { t: "presence"; listening: boolean; sync: SyncStatus; errorCode: number | null };

/** What adding a link did, for the person who pasted it. */
export interface AddResult {
  added: number;
  duplicates: number;
  overflow: number;
  skipped: { title: string | null; reason: string }[];
  truncated: boolean;
}

export type NackCode =
  | "stale"
  | "invalid"
  | "rate_limited"
  | "busy"
  | "invalid_url"
  | "unsupported_url"
  | "playlist_not_found"
  | "provider_unavailable"
  | "unavailable";

export type ServerMessage =
  /** `s` is the server's clock when the message was written. */
  | { t: "welcome"; s: number; you: string; room: RoomSnapshot; listeners: ListenerView[] }
  | { t: "snapshot"; s: number; room: RoomSnapshot; listeners: ListenerView[] }
  | { t: "pong"; id: number; c: number; s: number }
  | {
      t: "ev";
      v: number;
      by: string | null;
      events: RoomEvent[];
      tracks: TrackInfo[];
      activity: ActivityEntry | null;
    }
  | { t: "listeners"; listeners: ListenerView[]; people: Person[] }
  | { t: "ack"; id: string; result: AddResult | null }
  | { t: "nack"; id: string; code: NackCode };
