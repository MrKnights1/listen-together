import { describe, expect, test } from "bun:test";
import type { NackCode } from "@/modules/room/contract/messages.ts";
import { OWNER_COLORS, ownerColor } from "@/modules/room/ui/ownerColor.ts";
import {
  activityLine,
  addSummary,
  clearQuestion,
  formatDuration,
  presenceLine,
  refusal,
  songs,
} from "@/modules/room/ui/wording.ts";

describe("wording", () => {
  test.each([
    [0, "0:00"],
    [5_000, "0:05"],
    [185_000, "3:05"],
    [3_723_000, "1:02:03"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  test("explains every refusal the server can send, in words", () => {
    const codes: (NackCode | "disconnected")[] = [
      "stale",
      "invalid",
      "rate_limited",
      "busy",
      "invalid_url",
      "unsupported_url",
      "playlist_not_found",
      "song_not_in_playlist",
      "provider_unavailable",
      "unavailable",
      "disconnected",
    ];
    for (const code of codes) {
      expect(refusal(code).length).toBeGreaterThan(10);
      expect(refusal(code)).not.toContain(code);
    }
  });

  test("summarises a paste that added songs and skipped one", () => {
    expect(
      addSummary({
        added: 12,
        duplicates: 1,
        overflow: 0,
        skipped: [{ title: "Old video", reason: "private" }],
        truncated: false,
      }),
    ).toBe("Added 12 songs to your list. 1 song already queued. Skipped Old video: private.");
  });

  test("says when a playlist was cut short and when nothing was new", () => {
    const summary = addSummary({
      added: 0,
      duplicates: 3,
      overflow: 0,
      skipped: [],
      truncated: true,
    });

    expect(summary).toStartWith("Nothing new was added.");
    expect(summary).toContain("longer than the room can hold");
  });

  /** Nobody has a list of their own to fill any more: only the room can be full. */
  test("blames the full room for songs left out", () => {
    expect(
      addSummary({ added: 2, duplicates: 0, overflow: 3, skipped: [], truncated: false }),
    ).toBe("Added 2 songs to your list. 3 songs left out: the room is full.");
  });

  test("describes listeners in plain words", () => {
    expect(presenceLine(false, "idle", null)).toBe("Here, not listening");
    expect(presenceLine(true, "in_sync", null)).toBe("In sync");
    expect(presenceLine(true, "error", 150)).toBe("Can't play this song (YouTube error 150)");
    expect(presenceLine(true, "no_player", null)).toBe("YouTube's player didn't load");
  });

  test("describes feed lines with the song's title as it was", () => {
    expect(
      activityLine({ id: 1, at: 0, actorId: "a", kind: "skipped", detail: { title: "Song one" } }),
    ).toBe("skipped Song one");
    expect(
      activityLine({ id: 2, at: 0, actorId: null, kind: "auto_paused", detail: {} }),
    ).toContain("nobody was listening");
    expect(
      activityLine({ id: 3, at: 0, actorId: "a", kind: "seeked", detail: { positionMs: 90_000 } }),
    ).toBe("jumped to 1:30");
  });
});

describe("clearing the queue", () => {
  test("says how many songs went, in the feed", () => {
    const line = (count: number) =>
      activityLine({ id: 1, at: 0, actorId: "a", kind: "cleared", detail: { count } });

    expect(line(1)).toBe("cleared 1 song from the queue");
    expect(line(12)).toBe("cleared 12 songs from the queue");
  });

  test.each([
    [0, "0 songs"],
    [1, "1 song"],
    [12, "12 songs"],
  ])("writes a count of %d as %s", (count, text) => {
    expect(songs(count)).toBe(text);
  });

  test("asks about exactly the songs that will go, and that the song playing stays", () => {
    expect(clearQuestion(1)).toBe(
      "This removes 1 song from Up next for everyone. The song playing now keeps playing.",
    );
    expect(clearQuestion(12)).toBe(
      "This removes all 12 songs from Up next for everyone. The song playing now keeps playing.",
    );
  });
});

describe("shuffle in the feed", () => {
  test("says who turned shuffle on or off", () => {
    const line = (on: boolean) =>
      activityLine({ id: 1, at: 0, actorId: "a", kind: "shuffle_set", detail: { on } });

    expect(line(true)).toBe("turned shuffle on");
    expect(line(false)).toBe("turned shuffle off");
  });

  test("says who starred which song to play next, or took the star off", () => {
    const line = (on: boolean) =>
      activityLine({
        id: 1,
        at: 0,
        actorId: "a",
        kind: "star_set",
        detail: { trackId: "youtube:x", title: "Song x", on },
      });

    expect(line(true)).toBe("starred Song x to play next");
    expect(line(false)).toBe("unstarred Song x");
  });

  /** The feed keeps a month: lines from when one person shuffled only their own songs are still in it. */
  test("still reads a whole-queue shuffle from before shuffle was a switch", () => {
    const line = (ownerId: string | null) =>
      activityLine({ id: 1, at: 0, actorId: "a", kind: "shuffled", detail: { ownerId } });

    expect(line(null)).toBe("shuffled the queue");
    expect(line("a")).toBe("shuffled their songs");
  });
});

describe("ownerColor", () => {
  test("gives a person the same colour every time", () => {
    expect(ownerColor("user-ada")).toBe(ownerColor("user-ada"));
  });

  test("only ever hands out colours from the checked palette", () => {
    for (let index = 0; index < 200; index += 1) {
      expect(OWNER_COLORS).toContain(ownerColor(`user-${index}`) as (typeof OWNER_COLORS)[number]);
    }
  });

  test("spreads people across the palette", () => {
    const used = new Set(Array.from({ length: 60 }, (_, index) => ownerColor(`user-${index}`)));

    expect(used.size).toBe(OWNER_COLORS.length);
  });
});
