import { SongNotInPlaylist } from "@/modules/catalog/domain/errors.ts";

/**
 * A playlist's different videos, in order, from `startAt` — the song a link
 * pointed into — or from the top. A page is asked for only when the reader
 * wants a video the pages so far did not hold, so a reader that stops early
 * spends no more quota.
 *
 * Ends at the first page that brings nothing new: YouTube's Mixes never end;
 * they serve the same few dozen songs page after page. Throws
 * `SongNotInPlaylist` when the playlist ends without `startAt` in it.
 */
export async function* playlistVideoIds(
  pages: AsyncIterable<string[]>,
  startAt: string | null,
): AsyncGenerator<string> {
  const seen = new Set<string>();
  let started = startAt === null;

  for await (const page of pages) {
    let broughtNew = false;
    for (const videoId of page) {
      // A playlist can hold the same video twice; the room queues it once.
      if (seen.has(videoId)) continue;
      seen.add(videoId);
      broughtNew = true;

      started ||= videoId === startAt;
      if (started) yield videoId;
    }
    if (!broughtNew) break;
  }

  if (!started) throw new SongNotInPlaylist();
}
