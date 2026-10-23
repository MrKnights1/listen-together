import type { Track, UnplayableReason } from "./Track.ts";

export interface SkippedTrack {
  providerTrackId: string;
  /** Known when the provider described the track; null when it never answered for it. */
  title: string | null;
  reason: UnplayableReason;
}

/** What a pasted link turned into. */
export interface Resolution {
  kind: "video" | "playlist";
  /** Playable tracks, in the order the link gave them, without repeats. */
  tracks: Track[];
  /** Tracks the link named that cannot be played, with the reason for each. */
  skipped: SkippedTrack[];
  /** True when a playlist held more than this paste could use, and only its first part was taken. */
  truncated: boolean;
}
