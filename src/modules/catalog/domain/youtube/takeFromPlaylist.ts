import { SongNotInPlaylist } from "@/modules/catalog/domain/errors.ts";

/**
 * Reads a playlist page by page and keeps up to `limit` different videos,
 * starting at `startAt` — the song a link pointed into — or at the top.
 *
 * Asks for no page it does not need: it stops once it has enough, and once a
 * page brings nothing new. YouTube's Mixes never end; they serve the same few
 * dozen songs page after page.
 */
export async function takeFromPlaylist(
  pages: AsyncIterable<string[]>,
  startAt: string | null,
  limit: number,
): Promise<{ videoIds: string[]; hasMore: boolean }> {
  const seen = new Set<string>();
  const videoIds: string[] = [];
  let started = startAt === null;

  for await (const page of pages) {
    let broughtNew = false;
    for (const videoId of page) {
      // A playlist can hold the same video twice; the room queues it once.
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      broughtNew = true;

      started ||= videoId === startAt;
      if (!started) continue;
      if (videoIds.length === limit) return { videoIds, hasMore: true };
      videoIds.push(videoId);
    }
    if (!broughtNew) break;
  }

  if (!started) throw new SongNotInPlaylist();
  return { videoIds, hasMore: false };
}
