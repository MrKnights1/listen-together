import { describe, expect, test } from "bun:test";
import { Track } from "@/modules/catalog/domain/Track.ts";
import { trackFromVideo } from "@/modules/catalog/domain/youtube/trackFromVideo.ts";
import { track, videoFacts } from "@/modules/catalog/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");

describe("Track", () => {
  test("is known app-wide as provider:id", () => {
    expect(track("dQw4w9WgXcQ").id).toBe("youtube:dQw4w9WgXcQ");
  });

  test("is stale once fetched at or before the cutoff", () => {
    const one = track("dQw4w9WgXcQ", { fetchedAt: NOW });

    expect(one.isStale(NOW)).toBe(true);
    expect(one.isStale(new Date(NOW.getTime() - 1))).toBe(false);
  });

  test("refuses a playable track without a duration", () => {
    expect(() => Track.describe({ ...track("dQw4w9WgXcQ").toSnapshot(), durationMs: 0 })).toThrow(
      "needs a duration",
    );
  });

  test("refuses a duration that is not whole milliseconds", () => {
    expect(() => Track.describe({ ...track("dQw4w9WgXcQ").toSnapshot(), durationMs: 1.5 })).toThrow(
      "whole milliseconds",
    );
  });

  test("allows an unplayable track to have no duration", () => {
    expect(
      Track.describe({
        ...track("dQw4w9WgXcQ").toSnapshot(),
        durationMs: 0,
        unplayableReason: "live",
      }).isPlayable,
    ).toBe(false);
  });

  test("becoming unplayable keeps the metadata and dates the change", () => {
    const later = new Date(NOW.getTime() + 1000);
    const gone = track("dQw4w9WgXcQ").becameUnplayable("not_found", later);

    expect(gone.unplayableReason).toBe("not_found");
    expect(gone.title).toBe("Song dQw4w9WgXcQ");
    expect(gone.fetchedAt).toEqual(later);
  });
});

describe("trackFromVideo", () => {
  test("takes title, duration and artwork from YouTube", () => {
    const one = trackFromVideo(videoFacts("dQw4w9WgXcQ"), "EE", NOW);

    expect(one.title).toBe("Song dQw4w9WgXcQ");
    expect(one.durationMs).toBe(210_000);
    expect(one.artworkUrl).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
    expect(one.fetchedAt).toEqual(NOW);
    expect(one.isPlayable).toBe(true);
  });

  test("drops the ' - Topic' suffix of auto-generated music channels", () => {
    expect(trackFromVideo(videoFacts("dQw4w9WgXcQ"), "EE", NOW).artist).toBe("Some Artist");
  });

  test("leaves a channel name that merely contains 'Topic' alone", () => {
    const facts = videoFacts("dQw4w9WgXcQ", { channelTitle: "Topic Records" });

    expect(trackFromVideo(facts, "EE", NOW).artist).toBe("Topic Records");
  });

  test("records why an ineligible video cannot play", () => {
    const facts = videoFacts("dQw4w9WgXcQ", { embeddable: false });

    expect(trackFromVideo(facts, "EE", NOW).unplayableReason).toBe("not_embeddable");
  });

  test("keeps a live broadcast as an unplayable track with no duration", () => {
    const facts = videoFacts("dQw4w9WgXcQ", { liveBroadcastContent: "live", isoDuration: "P0D" });
    const one = trackFromVideo(facts, "EE", NOW);

    expect(one.unplayableReason).toBe("live");
    expect(one.durationMs).toBe(0);
  });
});
