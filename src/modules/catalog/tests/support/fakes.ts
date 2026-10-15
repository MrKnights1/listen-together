import type { Clock } from "@/shared/domain/Clock.ts";
import { PlaylistNotFound } from "@/modules/catalog/domain/errors.ts";
import { Track, type TrackSnapshot } from "@/modules/catalog/domain/Track.ts";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";
import type { YouTubeCatalog } from "@/modules/catalog/domain/ports/YouTubeCatalog.ts";
import type { VideoFacts } from "@/modules/catalog/domain/youtube/VideoFacts.ts";

export class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/** A playable, embeddable, public, processed video — the happy case — with overrides. */
export function videoFacts(videoId: string, overrides: Partial<VideoFacts> = {}): VideoFacts {
  return {
    videoId,
    title: `Song ${videoId}`,
    channelTitle: "Some Artist - Topic",
    isoDuration: "PT3M30S",
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    privacyStatus: "public",
    uploadStatus: "processed",
    embeddable: true,
    liveBroadcastContent: "none",
    ageRestricted: false,
    regionRestriction: null,
    ...overrides,
  };
}

export function track(videoId: string, overrides: Partial<TrackSnapshot> = {}): Track {
  return Track.restore({
    provider: "youtube",
    providerTrackId: videoId,
    title: `Song ${videoId}`,
    artist: "Some Artist",
    durationMs: 210_000,
    artworkUrl: null,
    unplayableReason: null,
    fetchedAt: new Date("2026-10-15T10:00:00.000Z"),
    ...overrides,
  });
}

/** Eleven-character ids, as YouTube's are: "vid00000001", "vid00000002", … */
export function videoId(index: number): string {
  return `vid${String(index).padStart(8, "0")}`;
}

export class InMemoryTrackRepository implements TrackRepository {
  private readonly byId = new Map<string, Track>();

  async findByIds(ids: string[]): Promise<Track[]> {
    return ids.map((id) => this.byId.get(id)).filter((one): one is Track => one !== undefined);
  }

  async saveAll(tracks: Track[]): Promise<void> {
    for (const one of tracks) this.byId.set(one.id, one);
  }

  async findStale(cutoff: Date): Promise<Track[]> {
    return [...this.byId.values()].filter((one) => one.isStale(cutoff));
  }

  async deleteByIds(ids: string[]): Promise<void> {
    for (const id of ids) this.byId.delete(id);
  }

  ids(): string[] {
    return [...this.byId.keys()].sort();
  }
}

/** YouTube as a table of videos and playlists, counting every call like quota. */
export class StubYouTubeCatalog implements YouTubeCatalog {
  readonly videoCalls: string[][] = [];
  readonly playlistCalls: string[] = [];
  readonly knownVideos = new Map<string, VideoFacts>();
  readonly playlists = new Map<string, string[]>();

  add(...facts: VideoFacts[]): void {
    for (const one of facts) this.knownVideos.set(one.videoId, one);
  }

  async videos(videoIds: string[]): Promise<VideoFacts[]> {
    this.videoCalls.push(videoIds);
    return videoIds
      .map((id) => this.knownVideos.get(id))
      .filter((one): one is VideoFacts => one !== undefined);
  }

  async playlistVideoIds(playlistId: string, limit: number) {
    this.playlistCalls.push(playlistId);
    const ids = this.playlists.get(playlistId);
    if (ids === undefined) throw new PlaylistNotFound();
    return { videoIds: ids.slice(0, limit), hasMore: ids.length > limit };
  }
}
