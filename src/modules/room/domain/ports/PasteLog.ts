import type { LinkScope } from "@/modules/room/domain/ports/TrackSource.ts";

/** One paste that reached the room. */
export interface Paste {
  actorId: string;
  /** Exactly as it was pasted: the room keeps the link nowhere else. */
  pasted: string;
  scope: LinkScope;
  added: number;
}

/** Where pastes are written down, so a host can tell later which playlist somebody added. */
export interface PasteLog {
  record(paste: Paste): void;
}
