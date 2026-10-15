import type { ProviderId } from "@/shared/domain/TrackRef.ts";

/**
 * What the room knows about a song: enough to show it and to hand it to the
 * right player. The room's own view, kept apart from the catalog's model.
 */
export interface TrackInfo {
  trackId: string;
  provider: ProviderId;
  providerTrackId: string;
  title: string;
  artist: string;
  durationMs: number;
  artworkUrl: string | null;
}
