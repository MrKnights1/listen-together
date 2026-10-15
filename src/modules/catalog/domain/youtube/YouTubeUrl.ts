/** What a YouTube link points at. */
export type YouTubeTarget =
  | { kind: "video"; videoId: string }
  | { kind: "playlist"; playlistId: string }
  /** A song played from inside a playlist: the person pasting it says which they meant. */
  | { kind: "videoInPlaylist"; videoId: string; playlistId: string };

/** YouTube video ids are exactly 11 characters of URL-safe base64. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Playlist ids vary by kind (PL…, OLAK5uy_…, UU…); bounded so junk is refused early. */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

/**
 * Liked videos, Watch Later and liked music: lists only their owner can see.
 * The Data API answers 404 or an empty list for them, so a song played from
 * one is just a song.
 */
const PRIVATE_LISTS = new Set(["LL", "WL", "LM"]);

const WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

/** Paths whose next segment is the video id. */
const VIDEO_PATH_PREFIXES = ["shorts", "embed", "live", "v"];

function video(id: string | null | undefined, list: string | null = null): YouTubeTarget | null {
  if (id === null || id === undefined || !VIDEO_ID.test(id)) return null;
  return list !== null && PLAYLIST_ID.test(list) && !PRIVATE_LISTS.has(list)
    ? { kind: "videoInPlaylist", videoId: id, playlistId: list }
    : { kind: "video", videoId: id };
}

function playlist(id: string | null): YouTubeTarget | null {
  return id !== null && PLAYLIST_ID.test(id) ? { kind: "playlist", playlistId: id } : null;
}

export function isYouTubeHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return WATCH_HOSTS.has(host) || SHORT_HOSTS.has(host);
}

/**
 * Reads a YouTube link. Null for anything on a YouTube host that does not name
 * a video or a playlist (a channel page, a search).
 *
 * A watch link that also carries `list=` is the song on screen when somebody
 * copies the address bar while a playlist plays. It could mean either, so it
 * comes back as `videoInPlaylist` and the person pasting it chooses.
 */
export function parseYouTubeUrl(url: URL): YouTubeTarget | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const list = url.searchParams.get("list");

  if (SHORT_HOSTS.has(host)) return video(segments[0], list);
  if (!WATCH_HOSTS.has(host)) return null;

  if (segments[0] === "watch") return video(url.searchParams.get("v"), list);
  if (segments[0] === "playlist") return playlist(list);

  const [prefix, id] = segments;
  if (prefix !== undefined && VIDEO_PATH_PREFIXES.includes(prefix)) return video(id);

  return null;
}
