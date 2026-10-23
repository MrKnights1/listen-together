/** One ping's answer: how long it took, and what that says about the server's clock. */
interface Sample {
  rttMs: number;
  /** Server epoch time minus local monotonic time. */
  offsetMs: number;
}

/** Enough samples to ride out one slow round trip, few enough to follow a changed route. */
const KEPT = 8;

/**
 * The server's clock, estimated from pings (NTP's idea, simplified). Each
 * answer says what the server's clock read; assuming that was halfway through
 * the round trip gives an offset whose error is at most half the trip. The
 * sample with the shortest trip is the most trustworthy, so it is the one used.
 *
 * Local times are `performance.now()` — monotonic, so a wall-clock change on
 * this device cannot shift the room's music.
 */
export class ClockSync {
  private samples: Sample[] = [];
  private stale = false;

  /** `sentAt` and `receivedAt` are local monotonic times; `serverTime` is the server's epoch time. */
  record(sentAt: number, receivedAt: number, serverTime: number): void {
    const rttMs = receivedAt - sentAt;
    if (!Number.isFinite(rttMs) || rttMs < 0) return;

    // A stale sample may have the shortest trip and so would outvote every fresh one.
    if (this.stale) this.samples = [];
    this.stale = false;
    this.samples.push({ rttMs, offsetMs: serverTime - (sentAt + rttMs / 2) });
    if (this.samples.length > KEPT) this.samples.shift();
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** The round trip of the sample in use: the error bound is half of it. */
  get bestRttMs(): number | null {
    return this.best()?.rttMs ?? null;
  }

  /** The server's time at local monotonic time `localNow`. */
  serverNow(localNow: number): number {
    const best = this.best();
    if (best === null) throw new Error("No clock sample yet: ping the server first.");
    return localNow + best.offsetMs;
  }

  /**
   * The connection to the server dropped. The estimate stays in use, so the
   * music plays on meanwhile; the first fresh sample replaces it.
   */
  markStale(): void {
    this.stale = true;
  }

  private best(): Sample | null {
    let best: Sample | null = null;
    for (const sample of this.samples)
      if (best === null || sample.rttMs < best.rttMs) best = sample;
    return best;
  }
}
