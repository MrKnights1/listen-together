import type { ProviderId } from "@/shared/domain/TrackRef.ts";
import type { Resolution } from "@/modules/catalog/domain/Resolution.ts";
import type { Track } from "@/modules/catalog/domain/Track.ts";

/**
 * One provider's way of turning links into tracks. Adding Spotify means adding
 * a resolver; nothing that asks for tracks has to change.
 */
export interface TrackResolver {
  readonly provider: ProviderId;
  recognizes(url: URL): boolean;
  resolve(url: URL): Promise<Resolution>;
  /**
   * Asks the provider again about tracks it described before. Tracks it no
   * longer answers for come back with `not_found`.
   */
  refresh(providerTrackIds: string[]): Promise<Track[]>;
}
