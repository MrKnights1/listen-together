/**
 * Time as a dependency, so expiry rules can be tested without waiting for them.
 */
export interface Clock {
  now(): Date;
}
