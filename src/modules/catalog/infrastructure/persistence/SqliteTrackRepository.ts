import type { Database } from "bun:sqlite";
import { isProviderId } from "@/shared/domain/TrackRef.ts";
import { Track, type UnplayableReason } from "@/modules/catalog/domain/Track.ts";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";

interface TrackRow {
  id: string;
  provider: string;
  provider_track_id: string;
  title: string;
  artist: string;
  duration_ms: number;
  artwork_url: string | null;
  unplayable_reason: string | null;
  fetched_at: number;
}

export class SqliteTrackRepository implements TrackRepository {
  constructor(private readonly db: Database) {}

  async findByIds(ids: string[]): Promise<Track[]> {
    // No ids would build `IN ()`, which is a syntax error rather than an empty answer.
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(", ");
    return this.db
      .query<TrackRow, string[]>(`SELECT * FROM tracks WHERE id IN (${placeholders})`)
      .all(...ids)
      .map(toTrack);
  }

  async saveAll(tracks: Track[]): Promise<void> {
    const upsert = this.db.query(
      `INSERT INTO tracks (id, provider, provider_track_id, title, artist, duration_ms, artwork_url, unplayable_reason, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title             = excluded.title,
         artist            = excluded.artist,
         duration_ms       = excluded.duration_ms,
         artwork_url       = excluded.artwork_url,
         unplayable_reason = excluded.unplayable_reason,
         fetched_at        = excluded.fetched_at`,
    );

    // One transaction: a 200-song playlist is one fsync, not two hundred.
    this.db.transaction(() => {
      for (const track of tracks) {
        const s = track.toSnapshot();
        upsert.run(
          track.id,
          s.provider,
          s.providerTrackId,
          s.title,
          s.artist,
          s.durationMs,
          s.artworkUrl,
          s.unplayableReason,
          s.fetchedAt.getTime(),
        );
      }
    })();
  }

  async findStale(cutoff: Date): Promise<Track[]> {
    return this.db
      .query<TrackRow, [number]>("SELECT * FROM tracks WHERE fetched_at <= ?")
      .all(cutoff.getTime())
      .map(toTrack);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const placeholders = ids.map(() => "?").join(", ");
    this.db.query(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...ids);
  }
}

function toTrack(row: TrackRow): Track {
  if (!isProviderId(row.provider)) {
    throw new Error(`Track ${row.id} has an unknown provider: ${row.provider}`);
  }

  return Track.restore({
    provider: row.provider,
    providerTrackId: row.provider_track_id,
    title: row.title,
    artist: row.artist,
    durationMs: row.duration_ms,
    artworkUrl: row.artwork_url,
    unplayableReason: row.unplayable_reason as UnplayableReason | null,
    fetchedAt: new Date(row.fetched_at),
  });
}
