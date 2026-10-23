import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";

/**
 * What to take from a link that names a song inside a playlist: just the song,
 * or the playlist from that song on.
 */
export type LinkScope = "song" | "playlist";

export interface SkippedSong {
  title: string | null;
  reason: string;
}

export interface ResolvedLink {
  tracks: TrackInfo[];
  skipped: SkippedSong[];
  truncated: boolean;
}

/**
 * Where the room gets songs from: the catalog, seen from here. Throws
 * `LinkRejected` for a link that adds nothing at all.
 */
export interface TrackSource {
  /** At most `limit` playable songs: a playlist past that comes back `truncated`. */
  resolve(pasted: string, scope: LinkScope, limit: number): Promise<ResolvedLink>;
  describe(trackIds: string[]): Promise<TrackInfo[]>;
  /** Daily upkeep of the songs still in use; returns the ones that can no longer play. */
  maintain(referencedTrackIds: string[]): Promise<string[]>;
}
