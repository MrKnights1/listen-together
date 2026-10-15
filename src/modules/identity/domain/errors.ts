/**
 * The codes these failures travel under. A union rather than `string` so the
 * one place they become a `/login?error=` reason has to name each of them.
 */
export type IdentityErrorCode =
  "invalid_identity" | "login_request_expired" | "not_allowed" | "state_mismatch";

/** Failures that are part of the sign-in rules rather than bugs. */
export abstract class IdentityError extends Error {
  abstract readonly code: IdentityErrorCode;
}

export class StateMismatch extends IdentityError {
  readonly code = "state_mismatch";
  constructor() {
    super("The sign-in response did not match the sign-in that started it.");
  }
}

export class LoginRequestExpired extends IdentityError {
  readonly code = "login_request_expired";
  constructor() {
    super("The sign-in took too long to complete.");
  }
}

export class InvalidIdentity extends IdentityError {
  readonly code = "invalid_identity";
  constructor(field: string) {
    super(`The Discord account is missing a usable ${field}.`);
  }
}

/** A real Discord account, just not one on this room's guest list. */
export class NotAllowed extends IdentityError {
  readonly code = "not_allowed";
  constructor() {
    super("This Discord account is not on the whitelist.");
  }
}
