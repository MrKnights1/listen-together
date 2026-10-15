/**
 * Somebody not on the guest list who signed in with Discord anyway: they are
 * asking to be let in. Only what Discord showed us is kept, and only until a
 * host answers or the request goes stale.
 */
export interface AccessRequest {
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  /** Their latest attempt. */
  requestedAt: Date;
}

/** Unanswered requests are forgotten after 30 days. */
export const ACCESS_REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** At most this many wait at once; the oldest give way, so strangers cannot fill the database. */
export const MAX_ACCESS_REQUESTS = 100;
