import type { TrackRef } from "@/shared/domain/TrackRef.ts";

/** A link that, pasted, adds exactly this song: how a song that played is added again. */
export function songLinkOf(ref: TrackRef): string {
  switch (ref.provider) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${encodeURIComponent(ref.providerTrackId)}`;
  }
}
