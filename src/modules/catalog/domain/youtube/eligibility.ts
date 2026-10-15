import type { UnplayableReason } from "../Track.ts";
import { parseIsoDuration } from "./isoDuration.ts";
import type { VideoFacts } from "./VideoFacts.ts";

/**
 * Whether the region may watch a video, per the Data API's rules: an `allowed`
 * list names the only places it plays (empty means nowhere); a `blocked` list
 * names where it does not (empty means nowhere is blocked).
 */
function blockedIn(restriction: VideoFacts["regionRestriction"], regionCode: string): boolean {
  if (restriction === null) return false;
  if (restriction.allowed !== undefined) return !restriction.allowed.includes(regionCode);
  if (restriction.blocked !== undefined) return restriction.blocked.includes(regionCode);
  return false;
}

/**
 * Why this video cannot be played in the room, or null if it can. Checked in
 * the order a person would want to hear about it: whether it exists for them
 * at all before why the embed refuses it.
 *
 * Passing here is necessary, not sufficient: YouTube may still refuse an embed
 * for one listener (a claim, their account, an ad). That is handled per
 * listener in the browser, never by skipping for everyone.
 */
export function unplayableReason(facts: VideoFacts, regionCode: string): UnplayableReason | null {
  if (facts.privacyStatus === "private") return "private";
  if (facts.uploadStatus !== "processed") return "not_processed";
  if (facts.liveBroadcastContent !== "none") return "live";
  if (facts.ageRestricted) return "age_restricted";
  if (!facts.embeddable) return "not_embeddable";
  if (blockedIn(facts.regionRestriction, regionCode)) return "region_blocked";

  const durationMs = parseIsoDuration(facts.isoDuration);
  if (durationMs === null || durationMs === 0) return "no_duration";

  return null;
}
