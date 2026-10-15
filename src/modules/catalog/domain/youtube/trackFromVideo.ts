import { Track } from "../Track.ts";
import { unplayableReason } from "./eligibility.ts";
import { parseIsoDuration } from "./isoDuration.ts";
import type { VideoFacts } from "./VideoFacts.ts";

/**
 * Auto-generated music channels are named "<Artist> - Topic". The suffix is
 * YouTube bookkeeping, not part of anybody's name.
 */
function artistOf(channelTitle: string): string {
  return channelTitle.replace(/\s+-\s+Topic$/, "").trim();
}

/** A track as YouTube describes it, judged playable or not for the room's region. */
export function trackFromVideo(facts: VideoFacts, regionCode: string, now: Date): Track {
  const reason = unplayableReason(facts, regionCode);

  return Track.describe({
    provider: "youtube",
    providerTrackId: facts.videoId,
    title: facts.title.trim(),
    artist: artistOf(facts.channelTitle),
    durationMs: parseIsoDuration(facts.isoDuration) ?? 0,
    artworkUrl: facts.thumbnailUrl,
    unplayableReason: reason,
    fetchedAt: now,
  });
}
