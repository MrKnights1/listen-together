import type { VideoFacts } from "@/modules/catalog/domain/youtube/VideoFacts.ts";

/** The YouTube Data API, as the resolver needs to see it. */
export interface YouTubeCatalog {
  /** Facts for each id YouTube still answers for; private or deleted ids are simply absent. */
  videos(videoIds: string[]): Promise<VideoFacts[]>;
  /**
   * A playlist's video ids in playlist order, one page per request. A page is
   * fetched only when asked for, so a reader that stops early spends no more
   * quota. Throws `PlaylistNotFound` for a playlist that is missing or not
   * public.
   */
  playlistPages(playlistId: string): AsyncIterable<string[]>;
}
