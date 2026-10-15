import { LoginRequestExpired, StateMismatch } from "./errors.ts";

/** A sign-in that has not come back from Discord yet is abandoned after this. */
export const LOGIN_REQUEST_TTL_MS = 10 * 60 * 1000;

export interface LoginRequestSnapshot {
  state: string;
  codeVerifier: string;
  expiresAt: Date;
}

/**
 * The half of an in-flight sign-in that stays with the browser.
 *
 * `state` proves the callback belongs to a sign-in this browser started (CSRF);
 * `codeVerifier` proves the code is redeemed by whoever requested it (PKCE).
 */
export class LoginRequest {
  private constructor(
    readonly state: string,
    readonly codeVerifier: string,
    readonly expiresAt: Date,
  ) {}

  static start(state: string, codeVerifier: string, now: Date): LoginRequest {
    return new LoginRequest(state, codeVerifier, new Date(now.getTime() + LOGIN_REQUEST_TTL_MS));
  }

  static restore(snapshot: LoginRequestSnapshot): LoginRequest {
    return new LoginRequest(snapshot.state, snapshot.codeVerifier, snapshot.expiresAt);
  }

  isExpired(now: Date): boolean {
    return now.getTime() >= this.expiresAt.getTime();
  }

  /** Throws unless this callback belongs to this sign-in and is still live. */
  verify(returnedState: string, now: Date): void {
    if (this.isExpired(now)) throw new LoginRequestExpired();
    if (!timingSafeEquals(this.state, returnedState)) throw new StateMismatch();
  }

  toSnapshot(): LoginRequestSnapshot {
    return { state: this.state, codeVerifier: this.codeVerifier, expiresAt: this.expiresAt };
  }
}

/** Compares without leaking where the first difference is. */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
