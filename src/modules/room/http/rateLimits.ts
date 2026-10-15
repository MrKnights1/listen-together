import type { Clock } from "@/shared/domain/Clock.ts";

/**
 * A token bucket: `capacity` actions at once, refilled one every `refillMs`.
 * Allows the burst a person makes by clicking fast, refuses a script.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
    private readonly clock: Clock,
  ) {
    this.tokens = capacity;
    this.updatedAt = clock.now().getTime();
  }

  take(): boolean {
    const now = this.clock.now().getTime();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.updatedAt) / this.refillMs);
    this.updatedAt = now;

    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export type LimitKind = "command" | "add" | "presence" | "ping";

/**
 * Per person, not per connection, so a second tab is not a second allowance.
 * Commands: 10 per 10 s. Links: 6 a minute — each may cost YouTube quota.
 * Presence: 4 per 10 s. Pings: 10 a minute — five on connect, then one a minute.
 */
const LIMITS: Record<LimitKind, { capacity: number; refillMs: number }> = {
  command: { capacity: 10, refillMs: 1000 },
  add: { capacity: 6, refillMs: 10_000 },
  presence: { capacity: 4, refillMs: 2500 },
  ping: { capacity: 10, refillMs: 6000 },
};

export class PersonLimits {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly clock: Clock) {}

  allow(userId: string, kind: LimitKind): boolean {
    const key = `${userId}:${kind}`;
    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      const { capacity, refillMs } = LIMITS[kind];
      bucket = new TokenBucket(capacity, refillMs, this.clock);
      this.buckets.set(key, bucket);
    }
    return bucket.take();
  }

  /** Forgets someone's buckets once their last tab closes; they are full again next time anyway. */
  forget(userId: string): void {
    for (const kind of Object.keys(LIMITS)) this.buckets.delete(`${userId}:${kind}`);
  }
}
