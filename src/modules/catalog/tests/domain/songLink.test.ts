import { describe, expect, test } from "bun:test";
import { offersPlaylistChoice } from "@/modules/catalog/domain/LinkScope.ts";
import { songLinkOf } from "@/modules/catalog/domain/songLink.ts";
import { parseYouTubeUrl } from "@/modules/catalog/domain/youtube/YouTubeUrl.ts";

describe("songLinkOf", () => {
  test("is a YouTube link to that one video, as the resolver reads it", () => {
    const link = songLinkOf({ provider: "youtube", providerTrackId: "dQw4w9WgXcQ" });

    expect(parseYouTubeUrl(new URL(link))).toEqual({ kind: "video", videoId: "dQw4w9WgXcQ" });
  });

  test("never asks whether the song or its playlist was meant", () => {
    expect(offersPlaylistChoice(songLinkOf({ provider: "youtube", providerTrackId: "abc" }))).toBe(
      false,
    );
  });
});
