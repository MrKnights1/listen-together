/** Measured from when the session was opened, not from last use. */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionSnapshot {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * A signed-in session. The session holds the *hash* of the token and never the
 * token itself, so nothing that can be replayed as a cookie is ever stored or
 * logged.
 */
export class Session {
  private constructor(
    readonly tokenHash: string,
    readonly userId: string,
    readonly createdAt: Date,
    readonly expiresAt: Date,
  ) {}

  static open(tokenHash: string, userId: string, now: Date): Session {
    return new Session(tokenHash, userId, now, new Date(now.getTime() + SESSION_LIFETIME_MS));
  }

  static restore(snapshot: SessionSnapshot): Session {
    return new Session(snapshot.tokenHash, snapshot.userId, snapshot.createdAt, snapshot.expiresAt);
  }

  /** Expiry is inclusive: a session is dead the instant it reaches expiresAt. */
  isExpired(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  toSnapshot(): SessionSnapshot {
    return {
      tokenHash: this.tokenHash,
      userId: this.userId,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }
}
