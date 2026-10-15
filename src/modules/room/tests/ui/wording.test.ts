import { describe, expect, test } from "bun:test";
import type { NackCode } from "@/modules/room/contract/messages.ts";
import { OWNER_COLORS, ownerColor } from "@/modules/room/ui/ownerColor.ts";
import {
  activityLine,
  addSummary,
  formatDuration,
  presenceLine,
  refusal,
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
