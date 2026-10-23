import type { Clock } from "@/shared/domain/Clock.ts";
import { trackIdOf } from "@/shared/domain/TrackRef.ts";
import { UnsupportedTrackUrl } from "@/modules/catalog/domain/errors.ts";
import type { LinkScope } from "@/modules/catalog/domain/LinkScope.ts";
import type { Resolution, SkippedTrack } from "@/modules/catalog/domain/Resolution.ts";
import type { Track } from "@/modules/catalog/domain/Track.ts";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";
import type { TrackResolver } from "@/modules/catalog/domain/ports/TrackResolver.ts";
import type { YouTubeCatalog } from "@/modules/catalog/domain/ports/YouTubeCatalog.ts";
import { playlistVideoIds } from "@/modules/catalog/domain/youtube/playlistVideoIds.ts";
import { trackFromVideo } from "@/modules/catalog/domain/youtube/trackFromVideo.ts";
import { isYouTubeHost, parseYouTubeUrl } from "@/modules/catalog/domain/youtube/YouTubeUrl.ts";

export interface YouTubeResolverOptions {
  /** Videos blocked in this ISO 3166-1 region are refused. */
  regionCode: string;
  /** The most videos of one pasted playlist that are looked at, playable or not. */
  maxPlaylistItems: number;
  /** Cached metadata younger than this is used without asking YouTube. */
  cacheTtlMs: number;
}

const youtubeTrackId = (videoId: string) =>
  trackIdOf({ provider: "youtube", providerTrackId: videoId });

/** As many ids as one `videos.list` request takes. */
const LOOKUP_BATCH = 50;

interface Found {
  tracks: Track[];
  skipped: SkippedTrack[];
}

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

  async resolve(url: URL, scope: LinkScope, limit: number): Promise<Resolution> {
    const target = parseYouTubeUrl(url);
    if (target === null) throw new UnsupportedTrackUrl();

    const found: Found = { tracks: [], skipped: [] };
    if (target.kind === "video" || (target.kind === "videoInPlaylist" && scope === "song")) {
      this.sortOut([target.videoId], await this.lookup([target.videoId]), found);
      return { kind: "video", ...found, truncated: false };
    }

    const startAt = target.kind === "videoInPlaylist" ? target.videoId : null;
    const truncated = await this.readPlaylist(target.playlistId, startAt, limit, found);
    return { kind: "playlist", ...found, truncated };
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

  /**
   * Reads the playlist until `limit` of its songs can play, looking them up a
   * batch at a time: unplayable songs take no place, and a full room asks
   * YouTube for no more than it needs. Returns whether the playlist held more.
   */
  private async readPlaylist(
    playlistId: string,
    startAt: string | null,
    limit: number,
    found: Found,
  ): Promise<boolean> {
    const ids = playlistVideoIds(this.catalog.playlistPages(playlistId), startAt);
    const wanted = Math.min(limit, this.options.maxPlaylistItems);
    let looked = 0;
    while (found.tracks.length < wanted && looked < this.options.maxPlaylistItems) {
      const size = Math.min(
        LOOKUP_BATCH,
        wanted - found.tracks.length,
        this.options.maxPlaylistItems - looked,
      );
      const batch: string[] = [];
      while (batch.length < size) {
        const next = await ids.next();
        if (next.done === true) break;
        batch.push(next.value);
      }
      if (batch.length === 0) return false;
      looked += batch.length;
      this.sortOut(batch, await this.lookup(batch), found);
      if (batch.length < size) return false;
    }
    // One more is read even when nothing was wanted: a missing playlist, or a song not in it,
    // is still said so to someone pasting into a full room.
    const more = (await ids.next()).done !== true;
    await ids.return(undefined);
    return more;
  }

  /** Each video, in order, as a track to add or a song skipped with its reason. */
  private sortOut(videoIds: string[], known: Map<string, Track>, found: Found): void {
    for (const videoId of videoIds) {
      const track = known.get(videoId);
      if (track === undefined) {
        found.skipped.push({ providerTrackId: videoId, title: null, reason: "not_found" });
      } else if (track.unplayableReason !== null) {
        found.skipped.push({
          providerTrackId: videoId,
          title: track.title,
          reason: track.unplayableReason,
        });
      } else {
        found.tracks.push(track);
      }
    }
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
