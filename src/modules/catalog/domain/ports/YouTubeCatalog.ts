import type { VideoFacts } from "@/modules/catalog/domain/youtube/VideoFacts.ts";

/** The YouTube Data API, as the resolver needs to see it. */
export interface YouTubeCatalog {
  /** Facts for each id YouTube still answers for; private or deleted ids are simply absent. */
  videos(videoIds: string[]): Promise<VideoFacts[]>;
  /**
   * The first `limit` video ids of a playlist, in playlist order, and whether
   * it holds more. Stops paging once it has enough, so a huge playlist costs
   * no more quota than a short one. Throws `PlaylistNotFound` for a playlist
   * that is missing or not public.
   */
  playlistVideoIds(
    playlistId: string,
    limit: number,
  ): Promise<{ videoIds: string[]; hasMore: boolean }>;
}
