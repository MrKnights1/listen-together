import type { Random } from "@/modules/room/domain/ports/Random.ts";

/**
 * Shuffle order only. `Math.random` is fine for deciding which song plays
 * next and would be wrong for anything an attacker could profit from
 * predicting — nothing of that kind may ever take this as its source.
 */
export class MathRandom implements Random {
  int(maxExclusive: number): number {
    return Math.floor(Math.random() * maxExclusive);
  }
}
