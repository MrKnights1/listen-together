/** Why a pasted link added nothing. */
export type LinkRejectionCode =
  "invalid_url" | "unsupported_url" | "playlist_not_found" | "provider_unavailable";

export class LinkRejected extends Error {
  constructor(readonly code: LinkRejectionCode) {
    super(`The link was not added: ${code}.`);
  }
}

/** The room has been suspended for shutdown and takes no more commands. */
export class RoomSuspended extends Error {
  constructor() {
    super("The room is shutting down.");
  }
}
