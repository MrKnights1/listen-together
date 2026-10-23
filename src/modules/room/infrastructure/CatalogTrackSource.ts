import {
  CatalogError,
  type FindTracks,
  type MaintainTrackCache,
  type ResolveTrackUrl,
  type Track,
} from "@/modules/catalog/index.ts";
import { LinkRejected } from "@/modules/room/domain/errors.ts";
import type {
  LinkScope,
  ResolvedLink,
  TrackSource,
} from "@/modules/room/domain/ports/TrackSource.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";

export interface CatalogUseCases {
  resolveTrackUrl: Pick<ResolveTrackUrl, "execute">;
  findTracks: Pick<FindTracks, "execute">;
  maintainTrackCache: Pick<MaintainTrackCache, "execute">;
}

function toTrackInfo(track: Track): TrackInfo {
  return {
    trackId: track.id,
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    title: track.title,
    artist: track.artist,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl,
  };
}

/** The catalog module, through its published use cases, as the room's `TrackSource`. */
export class CatalogTrackSource implements TrackSource {
  constructor(private readonly catalog: CatalogUseCases) {}

  async resolve(pasted: string, scope: LinkScope, limit: number): Promise<ResolvedLink> {
    try {
      const resolution = await this.catalog.resolveTrackUrl.execute(pasted, scope, limit);
      return {
        tracks: resolution.tracks.map(toTrackInfo),
        skipped: resolution.skipped.map((one) => ({ title: one.title, reason: one.reason })),
        truncated: resolution.truncated,
      };
    } catch (error) {
      if (error instanceof CatalogError) {
        // The cause stays in the log; the room only learns which kind of no it was.
        if (error.code === "provider_unavailable")
          console.error("Resolving a link failed", error.message);
        throw new LinkRejected(error.code);
      }
      throw error;
    }
  }

  async describe(trackIds: string[]): Promise<TrackInfo[]> {
    return (await this.catalog.findTracks.execute(trackIds)).map(toTrackInfo);
  }

  async maintain(referencedTrackIds: string[]): Promise<string[]> {
    return (await this.catalog.maintainTrackCache.execute(referencedTrackIds)).nowUnplayable;
  }
}
