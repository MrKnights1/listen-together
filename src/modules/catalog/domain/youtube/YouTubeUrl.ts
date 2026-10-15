/** What a YouTube link points at. */
export type YouTubeTarget =
  { kind: "video"; videoId: string } | { kind: "playlist"; playlistId: string };

/** YouTube video ids are exactly 11 characters of URL-safe base64. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Playlist ids vary by kind (PL…, OLAK5uy_…, UU…); bounded so junk is refused early. */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

const WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

/** Paths whose next segment is the video id. */
const VIDEO_PATH_PREFIXES = ["shorts", "embed", "live", "v"];

function video(id: string | null | undefined): YouTubeTarget | null {
  return id !== null && id !== undefined && VIDEO_ID.test(id)
    ? { kind: "video", videoId: id }
    : null;
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
 * A watch link that also carries `list=` adds just the video: that is the song
 * on screen when somebody copies the address bar, and silently queueing the
 * whole playlist behind it would surprise them. A playlist is added with its
 * own `/playlist?list=` link.
 */
export function parseYouTubeUrl(url: URL): YouTubeTarget | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((segment) => segment !== "");

  if (SHORT_HOSTS.has(host)) return video(segments[0]);
  if (!WATCH_HOSTS.has(host)) return null;

  if (segments[0] === "watch") return video(url.searchParams.get("v"));
  if (segments[0] === "playlist") return playlist(url.searchParams.get("list"));

  const [prefix, id] = segments;
  if (prefix !== undefined && VIDEO_PATH_PREFIXES.includes(prefix)) return video(id);

  return null;
}
