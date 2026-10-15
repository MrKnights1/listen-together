/**
 * The codes these failures travel under, so the room can turn each into a
 * sentence without parsing a message.
 */
export type CatalogErrorCode =
  | "invalid_url"
  | "unsupported_url"
  | "playlist_not_found"
  | "song_not_in_playlist"
  | "provider_unavailable";

/** Failures that are part of resolving a link rather than bugs. */
export abstract class CatalogError extends Error {
  abstract readonly code: CatalogErrorCode;
}

/** Not a link at all, or not an http(s) one. */
export class InvalidTrackUrl extends CatalogError {
  readonly code = "invalid_url";
  constructor() {
    super("That doesn't look like a link.");
  }
}

/** A link, but not to anything a provider here can play. */
export class UnsupportedTrackUrl extends CatalogError {
  readonly code = "unsupported_url";
  constructor() {
    super("Only YouTube video and playlist links can be added.");
  }
}

export class PlaylistNotFound extends CatalogError {
  readonly code = "playlist_not_found";
  constructor() {
    super("That playlist doesn't exist or isn't public.");
  }
}

/**
 * The playlist was asked for from a song it no longer holds. Refused rather
 * than read from the top: that would add songs nobody pointed at.
 */
export class SongNotInPlaylist extends CatalogError {
  readonly code = "song_not_in_playlist";
  constructor() {
    super("That song isn't in that playlist any more.");
  }
}

/**
 * The provider could not be asked: quota spent, outage, timeout. Deliberately
 * says nothing more — the cause belongs in the server log, not in the room.
 */
export class ProviderUnavailable extends CatalogError {
  readonly code = "provider_unavailable";
  constructor(detail: string) {
    super(detail);
  }
}
