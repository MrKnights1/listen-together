import { describe, expect, test } from "bun:test";
import { SongNotInPlaylist } from "@/modules/catalog/domain/errors.ts";
import { playlistVideoIds } from "@/modules/catalog/domain/youtube/playlistVideoIds.ts";

/** A playlist served page by page, counting the pages anybody asked for. */
function served(pages: string[][]) {
  const asked = { pages: 0 };
  async function* read() {
    for (const page of pages) {
      asked.pages += 1;
      yield page;
    }
  }
  return { pages: read(), asked };
}

/** Reads up to `limit` videos, as the resolver does, then looks one further to tell whether there were more. */
async function takeFromPlaylist(
  pages: AsyncIterable<string[]>,
  startAt: string | null,
  limit: number,
): Promise<{ videoIds: string[]; hasMore: boolean }> {
  const ids = playlistVideoIds(pages, startAt);
  const videoIds: string[] = [];
  while (videoIds.length < limit) {
    const next = await ids.next();
    if (next.done === true) return { videoIds, hasMore: false };
    videoIds.push(next.value);
  }
  return { videoIds, hasMore: (await ids.next()).done !== true };
}

describe("playlistVideoIds — from the top", () => {
  test("takes every video of a playlist shorter than the limit, in order", async () => {
    const { pages } = served([["a", "b"], ["c"]]);

    expect(await takeFromPlaylist(pages, null, 10)).toEqual({
      videoIds: ["a", "b", "c"],
      hasMore: false,
    });
  });

  test("stops at the limit and says there was more", async () => {
    const { pages } = served([
      ["a", "b"],
      ["c", "d"],
    ]);

    expect(await takeFromPlaylist(pages, null, 3)).toEqual({
      videoIds: ["a", "b", "c"],
      hasMore: true,
    });
  });

  test("knows a playlist exactly the size of the limit has nothing more", async () => {
    const { pages } = served([["a", "b"], ["c"]]);

    expect((await takeFromPlaylist(pages, null, 3)).hasMore).toBe(false);
  });

  /** Every page is a request against the daily quota. */
  test("asks for no page past the one where the limit was passed", async () => {
    const { pages, asked } = served([["a", "b"], ["c", "d"], ["e", "f"], ["g"]]);

    await takeFromPlaylist(pages, null, 3);

    expect(asked.pages).toBe(2);
  });

  test("keeps a video the playlist repeats only once", async () => {
    const { pages } = served([
      ["a", "b", "a"],
      ["c", "b"],
    ]);

    expect((await takeFromPlaylist(pages, null, 10)).videoIds).toEqual(["a", "b", "c"]);
  });

  test("takes nothing from an empty playlist", async () => {
    const { pages } = served([[]]);

    expect(await takeFromPlaylist(pages, null, 10)).toEqual({ videoIds: [], hasMore: false });
  });
});

describe("playlistVideoIds — from a song in it", () => {
  test("starts at the song, wherever its page", async () => {
    const { pages } = served([["a", "b"], ["c", "d"], ["e"]]);

    expect((await takeFromPlaylist(pages, "d", 10)).videoIds).toEqual(["d", "e"]);
  });

  test("counts the limit from the song, not from the top", async () => {
    const { pages } = served([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);

    expect(await takeFromPlaylist(pages, "c", 2)).toEqual({ videoIds: ["c", "d"], hasMore: true });
  });

  test("starts at the song's first place in a playlist that holds it twice", async () => {
    const { pages } = served([
      ["a", "b"],
      ["c", "b", "d"],
    ]);

    expect((await takeFromPlaylist(pages, "b", 10)).videoIds).toEqual(["b", "c", "d"]);
  });

  test("refuses a song the playlist no longer holds, having read it all", async () => {
    const { pages, asked } = served([["a", "b"], ["c"]]);

    await expect(takeFromPlaylist(pages, "gone", 10)).rejects.toThrow(SongNotInPlaylist);
    expect(asked.pages).toBe(2);
  });
});

/** A Mix never ends: YouTube keeps serving pages of songs it already served. */
describe("playlistVideoIds — a list that repeats itself", () => {
  test("stops at the first page that brings nothing new", async () => {
    const { pages, asked } = served([
      ["a", "b", "c"],
      ["a", "c", "b"],
      ["d", "a"],
    ]);

    expect(await takeFromPlaylist(pages, "b", 10)).toEqual({
      videoIds: ["b", "c"],
      hasMore: false,
    });
    expect(asked.pages).toBe(2);
  });

  test("refuses a song not found before the list began repeating", async () => {
    const { pages } = served([["a", "b"], ["b", "a"], ["z"]]);

    await expect(takeFromPlaylist(pages, "z", 10)).rejects.toThrow(SongNotInPlaylist);
  });
});
