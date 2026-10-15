/**
 * Where a track comes from. Shared because three modules speak it: the catalog
 * resolves links into tracks, the room queues them, and the browser picks the
 * player that can play them. Adding a provider starts here.
 */
export type ProviderId = "youtube";

export const PROVIDERS: readonly ProviderId[] = ["youtube"];

export interface TrackRef {
  provider: ProviderId;
  /** The provider's own id for the track, e.g. a YouTube video id. */
  providerTrackId: string;
}

/** The one id a track is known by across the app: `<provider>:<provider track id>`. */
export function trackIdOf(ref: TrackRef): string {
  return `${ref.provider}:${ref.providerTrackId}`;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}
