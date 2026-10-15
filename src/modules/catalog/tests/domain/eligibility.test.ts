import { describe, expect, test } from "bun:test";
import { unplayableReason } from "@/modules/catalog/domain/youtube/eligibility.ts";
import { videoFacts } from "@/modules/catalog/tests/support/fakes.ts";

const judge = (overrides: Parameters<typeof videoFacts>[1]) =>
  unplayableReason(videoFacts("dQw4w9WgXcQ", overrides), "EE");

describe("unplayableReason", () => {
  test("a public, processed, embeddable video with a length plays", () => {
    expect(judge({})).toBeNull();
  });

  test("unlisted videos play: anyone with the link may watch them", () => {
    expect(judge({ privacyStatus: "unlisted" })).toBeNull();
  });

  test.each([
    [{ privacyStatus: "private" }, "private"],
    [{ uploadStatus: "uploaded" }, "not_processed"],
    [{ uploadStatus: "failed" }, "not_processed"],
    [{ uploadStatus: "rejected" }, "not_processed"],
    [{ uploadStatus: "deleted" }, "not_processed"],
    [{ liveBroadcastContent: "live" }, "live"],
    [{ liveBroadcastContent: "upcoming" }, "live"],
    [{ ageRestricted: true }, "age_restricted"],
    [{ embeddable: false }, "not_embeddable"],
    [{ isoDuration: "P0D" }, "no_duration"],
    [{ isoDuration: "garbage" }, "no_duration"],
  ] as const)("%o is refused as %s", (overrides, reason) => {
    expect(judge(overrides)).toBe(reason);
  });

  describe("region restrictions", () => {
    test("an allow-list that includes the region plays", () => {
      expect(judge({ regionRestriction: { allowed: ["EE", "FI"] } })).toBeNull();
    });

    test("an allow-list without the region is blocked", () => {
      expect(judge({ regionRestriction: { allowed: ["US"] } })).toBe("region_blocked");
    });

    /** Per the Data API: an empty allow-list means blocked in every country. */
    test("an empty allow-list is blocked everywhere", () => {
      expect(judge({ regionRestriction: { allowed: [] } })).toBe("region_blocked");
    });

    test("a block-list naming the region is blocked", () => {
      expect(judge({ regionRestriction: { blocked: ["EE"] } })).toBe("region_blocked");
    });

    /** Per the Data API: an empty block-list means viewable everywhere. */
    test("an empty block-list blocks nothing", () => {
      expect(judge({ regionRestriction: { blocked: [] } })).toBeNull();
    });
  });

  test("a private video is reported as private even if it is also unembeddable", () => {
    expect(judge({ privacyStatus: "private", embeddable: false })).toBe("private");
  });
});
