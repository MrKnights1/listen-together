/** Chance as a dependency, so a shuffle can be tested by choosing its outcome. */
export interface Random {
  /** A whole number from 0 up to, not including, `maxExclusive`. */
  int(maxExclusive: number): number;
}
