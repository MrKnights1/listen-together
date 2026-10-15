/**
 * Source of unguessable values and their one-way hashes. A port so the sign-in
 * rules can be tested with predictable tokens.
 */
export interface TokenGenerator {
  /** Enough entropy that guessing it is not a threat. */
  generate(): string;
  /** Used to store a token without storing the token. */
  hash(token: string): string;
}
