import { InvalidTrackUrl } from "./errors.ts";
import { parseTrackUrl } from "./trackUrl.ts";
import { parseYouTubeUrl } from "./youtube/YouTubeUrl.ts";

/**
 * What to take from a link that names a song inside a playlist: just the song,
 * or the playlist from that song on. Links naming only one of the two ignore it.
 */
export type LinkScope = "song" | "playlist";

/**
 * True when the pasted text names a song inside a playlist, so the person
 * pasting it has to say which they meant. Anything that is not a link is
 * false: adding it reports why, as for any other bad paste.
 */
export function offersPlaylistChoice(pasted: string): boolean {
  let url: URL;
  try {
    url = parseTrackUrl(pasted);
  } catch (error) {
    if (error instanceof InvalidTrackUrl) return false;
    throw error;
  }
  return parseYouTubeUrl(url)?.kind === "videoInPlaylist";
}
