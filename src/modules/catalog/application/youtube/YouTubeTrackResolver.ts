import type { Clock } from "@/shared/domain/Clock.ts";
import { trackIdOf } from "@/shared/domain/TrackRef.ts";
import { UnsupportedTrackUrl } from "@/modules/catalog/domain/errors.ts";
import type { LinkScope } from "@/modules/catalog/domain/LinkScope.ts";
import type { Resolution, SkippedTrack } from "@/modules/catalog/domain/Resolution.ts";
import type { Track } from "@/modules/catalog/domain/Track.ts";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";
import type { TrackResolver } from "@/modules/catalog/domain/ports/TrackResolver.ts";
import type { YouTubeCatalog } from "@/modules/catalog/domain/ports/YouTubeCatalog.ts";
import { takeFromPlaylist } from "@/modules/catalog/domain/youtube/takeFromPlaylist.ts";
import { trackFromVideo } from "@/modules/catalog/domain/youtube/trackFromVideo.ts";
import {
  isYouTubeHost,
  parseYouTubeUrl,
  type YouTubeTarget,
} from "@/modules/catalog/domain/youtube/YouTubeUrl.ts";

export interface YouTubeResolverOptions {
  /** Videos blocked in this ISO 3166-1 region are refused. */
  regionCode: string;
  /** The most videos one pasted playlist may add. */
  maxPlaylistItems: number;
  /** Cached metadata younger than this is used without asking YouTube. */
  cacheTtlMs: number;
}

const youtubeTrackId = (videoId: string) =>
  trackIdOf({ provider: "youtube", providerTrackId: videoId });

/**
 * Turns YouTube links into tracks, asking the Data API only for what the cache
 * cannot answer: a song pasted again, or replayed by repeat-all, costs nothing.
 */
export class YouTubeTrackResolver implements TrackResolver {
  readonly provider = "youtube";

  constructor(
    private readonly catalog: YouTubeCatalog,
    private readonly tracks: TrackRepository,
    private readonly clock: Clock,
    private readonly options: YouTubeResolverOptions,
  ) {}

  recognizes(url: URL): boolean {
    return isYouTubeHost(url);
  }

  async resolve(url: URL, scope: LinkScope): Promise<Resolution> {
    const target = parseYouTubeUrl(url);
    if (target === null) throw new UnsupportedTrackUrl();

    const { kind, videoIds, truncated } = await this.videoIdsOf(target, scope);
    const known = await this.lookup(videoIds);

    const tracks: Track[] = [];
    const skipped: SkippedTrack[] = [];
    for (const videoId of videoIds) {
      const track = known.get(videoId);
      if (track === undefined) {
        skipped.push({ providerTrackId: videoId, title: null, reason: "not_found" });
      } else if (track.unplayableReason !== null) {
        skipped.push({
          providerTrackId: videoId,
          title: track.title,
          reason: track.unplayableReason,
        });
      } else {
        tracks.push(track);
      }
    }

    return { kind, tracks, skipped, truncated };
  }

  async refresh(videoIds: string[]): Promise<Track[]> {
    const now = this.clock.now();
    const cached = await this.tracks.findByIds(videoIds.map(youtubeTrackId));
    const answered = new Map(
      (await this.catalog.videos(videoIds)).map((facts) => [
        facts.videoId,
        trackFromVideo(facts, this.options.regionCode, now),
      ]),
    );

    // A video YouTube stopped answering for has been deleted or made private.
    const refreshed = cached.map(
      (track) => answered.get(track.providerTrackId) ?? track.becameUnplayable("not_found", now),
    );

    await this.tracks.saveAll(refreshed);
    return refreshed;
  }

  /** The videos a link names, in order: one song, or a playlist from the top or from a song in it. */
  private async videoIdsOf(
    target: YouTubeTarget,
    scope: LinkScope,
  ): Promise<{ kind: Resolution["kind"]; videoIds: string[]; truncated: boolean }> {
    if (target.kind === "video" || (target.kind === "videoInPlaylist" && scope === "song")) {
      return { kind: "video", videoIds: [target.videoId], truncated: false };
    }

    const startAt = target.kind === "videoInPlaylist" ? target.videoId : null;
    const taken = await takeFromPlaylist(
      this.catalog.playlistPages(target.playlistId),
      startAt,
      this.options.maxPlaylistItems,
    );
    return { kind: "playlist", videoIds: taken.videoIds, truncated: taken.hasMore };
  }

  /** Cached tracks still fresh enough, plus whatever YouTube says about the rest. */
  private async lookup(videoIds: string[]): Promise<Map<string, Track>> {
    const now = this.clock.now();
    const freshAfter = new Date(now.getTime() - this.options.cacheTtlMs);

    const known = new Map<string, Track>();
    for (const track of await this.tracks.findByIds(videoIds.map(youtubeTrackId))) {
      if (!track.isStale(freshAfter)) known.set(track.providerTrackId, track);
    }

    const missing = videoIds.filter((videoId) => !known.has(videoId));
    if (missing.length === 0) return known;

    const fetched = (await this.catalog.videos(missing)).map((facts) =>
      trackFromVideo(facts, this.options.regionCode, now),
    );
    await this.tracks.saveAll(fetched);
    for (const track of fetched) known.set(track.providerTrackId, track);

    return known;
  }
}
