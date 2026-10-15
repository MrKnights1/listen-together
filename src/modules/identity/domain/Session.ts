const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a session lives without being used: 400 days, the longest a
 * browser keeps a cookie. Each visit renews it, so somebody who keeps coming
 * back is never signed out.
 */
export const SESSION_LIFETIME_MS = 400 * DAY_MS;

/** Renewed at most once a day, so using the room is not a database write per request. */
export const SESSION_RENEWAL_INTERVAL_MS = DAY_MS;

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

  /**
   * True once a renewal interval has passed since the session was opened or
   * last renewed. Read from the expiry, so a session opened under a shorter
   * lifetime is due at once.
   */
  isDueForRenewal(now: Date): boolean {
    const renewedAt = this.expiresAt.getTime() - SESSION_LIFETIME_MS;
    return now.getTime() - renewedAt >= SESSION_RENEWAL_INTERVAL_MS;
  }

  /** The same session, alive for another full lifetime from `now`. */
  renewed(now: Date): Session {
    return new Session(
      this.tokenHash,
      this.userId,
      this.createdAt,
      new Date(now.getTime() + SESSION_LIFETIME_MS),
    );
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
