/**
 * Time passing as a dependency, for the same reason `Clock` exists: so "the
 * track ends in three minutes" can be tested by deciding when that happens
 * rather than by waiting for it.
 */
export interface Timers {
  /** Runs `tick` every `milliseconds`. Returns the function that stops it. */
  every(milliseconds: number, tick: () => void | Promise<void>): () => void;

  /**
   * Runs `fire` once, `milliseconds` from now, however far away that is.
   * Returns the function that cancels it; cancelling after it fired is a no-op.
   */
  after(milliseconds: number, fire: () => void | Promise<void>): () => void;
}
