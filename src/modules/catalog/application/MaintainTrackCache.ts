import type { Clock } from "@/shared/domain/Clock.ts";
import type { ProviderId } from "@/shared/domain/TrackRef.ts";
import type { Track } from "@/modules/catalog/domain/Track.ts";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";
import type { TrackResolver } from "@/modules/catalog/domain/ports/TrackResolver.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * YouTube's developer policies (§III.E.4) allow keeping API data for 30 days
 * before it must be refreshed or deleted. Refreshing at 25 leaves a daily job
 * five chances to succeed before a still-queued song falls foul of that.
 */
export const REFRESH_AFTER_MS = 25 * DAY_MS;
export const DELETE_AFTER_MS = 30 * DAY_MS;

export interface CacheMaintenance {
  refreshed: number;
  deleted: number;
  /** Still-referenced tracks that turned out to be gone or blocked since they were cached. */
  nowUnplayable: string[];
}

/**
 * Daily housekeeping for the metadata cache. The caller says which tracks are
 * still in use (queued, or playing): those are refreshed when old, everything
 * else is deleted once it reaches the 30-day limit.
 */
export class MaintainTrackCache {
  private readonly resolvers: Map<ProviderId, TrackResolver>;

  constructor(
    resolvers: TrackResolver[],
    private readonly tracks: TrackRepository,
    private readonly clock: Clock,
  ) {
    this.resolvers = new Map(resolvers.map((resolver) => [resolver.provider, resolver]));
  }

  async execute(referencedTrackIds: string[]): Promise<CacheMaintenance> {
    const now = this.clock.now();
    const referenced = new Set(referencedTrackIds);
    const stale = await this.tracks.findStale(new Date(now.getTime() - REFRESH_AFTER_MS));

    const expired = new Date(now.getTime() - DELETE_AFTER_MS);
    const toDelete = stale.filter((track) => !referenced.has(track.id) && track.isStale(expired));
    await this.tracks.deleteByIds(toDelete.map((track) => track.id));

    const toRefresh = stale.filter((track) => referenced.has(track.id));
    const refreshed: Track[] = [];
    for (const [provider, group] of groupByProvider(toRefresh)) {
      const resolver = this.resolvers.get(provider);
      if (resolver === undefined) throw new Error(`No resolver for provider ${provider}.`);
      refreshed.push(...(await resolver.refresh(group.map((track) => track.providerTrackId))));
    }

    return {
      refreshed: refreshed.length,
      deleted: toDelete.length,
      nowUnplayable: refreshed.filter((track) => !track.isPlayable).map((track) => track.id),
    };
  }
}

function groupByProvider(tracks: Track[]): Map<ProviderId, Track[]> {
  const groups = new Map<ProviderId, Track[]>();
  for (const track of tracks) {
    groups.set(track.provider, [...(groups.get(track.provider) ?? []), track]);
  }
  return groups;
}
