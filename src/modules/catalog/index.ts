/**
 * Public surface of the catalog module. Shape: LAYERED — link grammar, ISO-8601
 * durations and YouTube's eligibility rules are pure and worth testing without
 * the network; the Data API is an adapter behind a port.
 */
export { ResolveTrackUrl } from "./application/ResolveTrackUrl.ts";
export { FindTracks } from "./application/FindTracks.ts";
export {
  MaintainTrackCache,
  DELETE_AFTER_MS,
  REFRESH_AFTER_MS,
  type CacheMaintenance,
} from "./application/MaintainTrackCache.ts";
export {
  YouTubeTrackResolver,
  type YouTubeResolverOptions,
} from "./application/youtube/YouTubeTrackResolver.ts";
export { CatalogError, type CatalogErrorCode } from "./domain/errors.ts";
export type { Resolution, SkippedTrack } from "./domain/Resolution.ts";
export type { Track, UnplayableReason } from "./domain/Track.ts";
export type { TrackResolver } from "./domain/ports/TrackResolver.ts";
export {
  YOUTUBE_DATA_API,
  YouTubeDataApiClient,
  type YouTubeDataApiConfig,
} from "./infrastructure/youtube/YouTubeDataApiClient.ts";
export { SqliteTrackRepository } from "./infrastructure/persistence/SqliteTrackRepository.ts";
