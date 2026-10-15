import { trackIdOf, type ProviderId } from "@/shared/domain/TrackRef.ts";

/** Why a track exists in the catalog but cannot be queued. */
export type UnplayableReason =
  | "not_found"
  | "private"
  | "not_processed"
  | "live"
  | "age_restricted"
  | "not_embeddable"
  | "region_blocked"
  | "no_duration";

export interface TrackSnapshot {
  provider: ProviderId;
  providerTrackId: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl: string | null;
  unplayableReason: UnplayableReason | null;
  fetchedAt: Date;
}

/**
 * A song as the room needs it: enough to show it, and a duration the server
 * can schedule the next song by. Metadata is a cached copy of the provider's,
 * dated so it can be refreshed or forgotten.
 */
export class Track {
  private constructor(
    readonly provider: ProviderId,
    readonly providerTrackId: string,
    readonly title: string,
    readonly artist: string,
    readonly durationMs: number,
    readonly artworkUrl: string | null,
    readonly unplayableReason: UnplayableReason | null,
    readonly fetchedAt: Date,
  ) {}

  /**
   * A track freshly described by its provider. Refuses a duration that is not a
   * whole, non-negative number of milliseconds, and a playable track with no
   * duration at all: the server schedules the next song by it.
   */
  static describe(snapshot: TrackSnapshot): Track {
    if (!Number.isInteger(snapshot.durationMs) || snapshot.durationMs < 0) {
      throw new Error(`A track's duration must be whole milliseconds, got ${snapshot.durationMs}.`);
    }
    if (snapshot.unplayableReason === null && snapshot.durationMs === 0) {
      throw new Error("A playable track needs a duration.");
    }
    return Track.restore(snapshot);
  }

  /** Rebuilds a cached track. No rules run — they ran when it was fetched. */
  static restore(snapshot: TrackSnapshot): Track {
    return new Track(
      snapshot.provider,
      snapshot.providerTrackId,
      snapshot.title,
      snapshot.artist,
      snapshot.durationMs,
      snapshot.artworkUrl,
      snapshot.unplayableReason,
      snapshot.fetchedAt,
    );
  }

  get id(): string {
    return trackIdOf({ provider: this.provider, providerTrackId: this.providerTrackId });
  }

  get isPlayable(): boolean {
    return this.unplayableReason === null;
  }

  /** Fetched at or before `cutoff`: old enough to ask the provider again. */
  isStale(cutoff: Date): boolean {
    return this.fetchedAt.getTime() <= cutoff.getTime();
  }

  /** The same track, as the provider now reports it: gone or blocked, as of `now`. */
  becameUnplayable(reason: UnplayableReason, now: Date): Track {
    return Track.restore({ ...this.toSnapshot(), unplayableReason: reason, fetchedAt: now });
  }

  toSnapshot(): TrackSnapshot {
    return {
      provider: this.provider,
      providerTrackId: this.providerTrackId,
      title: this.title,
      artist: this.artist,
      durationMs: this.durationMs,
      artworkUrl: this.artworkUrl,
      unplayableReason: this.unplayableReason,
      fetchedAt: this.fetchedAt,
    };
  }
}
