import type { Track } from "@/modules/catalog/domain/Track.ts";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";

/** Cached tracks by id, in one read — the room shows a whole queue at once. */
export class FindTracks {
  constructor(private readonly tracks: TrackRepository) {}

  async execute(trackIds: string[]): Promise<Track[]> {
    return await this.tracks.findByIds([...new Set(trackIds)]);
  }
}
