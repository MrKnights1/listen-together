import { InvalidTrackUrl } from "./errors.ts";

/** Longer than any real link, short enough that nobody pastes a novel into the parser. */
export const MAX_URL_LENGTH = 2048;

/**
 * Turns whatever was pasted into a URL. A missing scheme is accepted — people
 * paste `youtu.be/…` — but only http and https come out the other end.
 */
export function parseTrackUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH) throw new InvalidTrackUrl();

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidTrackUrl();
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") throw new InvalidTrackUrl();
  // A bare word given an https:// prefix still parses — "hello" becomes
  // https://hello/ — so a host with no dot is a word somebody typed, not a link.
  if (!url.hostname.includes(".")) throw new InvalidTrackUrl();
  return url;
}
