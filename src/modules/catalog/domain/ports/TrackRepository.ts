import type { Track } from "@/modules/catalog/domain/Track.ts";

/** The metadata cache. Tracks are keyed by their app-wide id, `<provider>:<id>`. */
export interface TrackRepository {
  /** Ids that match nothing are absent from the answer. */
  findByIds(ids: string[]): Promise<Track[]>;
  /** Inserts new tracks and overwrites cached ones with fresher metadata. */
  saveAll(tracks: Track[]): Promise<void>;
  /** Tracks fetched at or before `cutoff`. */
  findStale(cutoff: Date): Promise<Track[]>;
  deleteByIds(ids: string[]): Promise<void>;
}
