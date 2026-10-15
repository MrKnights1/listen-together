import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { PlaylistNotFound, ProviderUnavailable } from "@/modules/catalog/domain/errors.ts";
import { YouTubeDataApiClient } from "@/modules/catalog/infrastructure/youtube/YouTubeDataApiClient.ts";
import { videoId } from "@/modules/catalog/tests/support/fakes.ts";

/**
 * The real adapter against a local stand-in for the Data API. YouTube is the
 * external boundary, so it is the only thing replaced; every request is real
 * HTTP and recorded for the assertions.
 */
const API_KEY = "AIza-test-key-SECRET";

let fakeYouTube: Server<unknown>;
let requests: URL[];
let playlistLength: number;
let failWith: { status: number; reason: string | null } | null;

function videoItem(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    snippet: {
      title: `Song ${id}`,
      channelTitle: "Artist - Topic",
      liveBroadcastContent: "none",
      thumbnails: {
        default: { url: `https://i.ytimg.com/vi/${id}/default.jpg` },
        medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` },
      },
    },
    contentDetails: { duration: "PT3M5S" },
    status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true },
    ...extra,
  };
}

beforeAll(() => {
  fakeYouTube = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);

      if (failWith !== null) {
        const body =
          failWith.reason === null
            ? "<html>proxy error</html>"
            : JSON.stringify({
                error: { code: failWith.status, errors: [{ reason: failWith.reason }] },
              });
        return new Response(body, { status: failWith.status });
      }

      if (url.pathname === "/youtube/v3/videos") {
        const ids = (url.searchParams.get("id") ?? "").split(",");
        // A private or deleted video is simply absent, as on the real API.
        return Response.json({
          items: ids.filter((id) => !id.startsWith("gone")).map((id) => videoItem(id)),
        });
      }

      if (url.pathname === "/youtube/v3/playlistItems") {
        if (url.searchParams.get("playlistId") === "PLmissing") {
          return Response.json(
            { error: { errors: [{ reason: "playlistNotFound" }] } },
            { status: 404 },
          );
        }
        const page = Number(url.searchParams.get("pageToken") ?? "0");
        const start = page * 50;
        const end = Math.min(start + 50, playlistLength);
        const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => ({
          contentDetails: { videoId: videoId(start + offset + 1) },
        }));
        return Response.json(
          end < playlistLength ? { items, nextPageToken: String(page + 1) } : { items },
        );
      }

      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => void fakeYouTube.stop(true));

beforeEach(() => {
  requests = [];
  playlistLength = 0;
  failWith = null;
});

function client(): YouTubeDataApiClient {
  return new YouTubeDataApiClient({
    apiKey: API_KEY,
    baseUrl: `${fakeYouTube.url.origin}/youtube/v3`,
  });
}

async function failureOf(run: () => Promise<unknown>): Promise<Error> {
  const outcome = await run().then(
    () => null,
    (error: unknown) => error,
  );
  if (!(outcome instanceof Error)) throw new Error("Expected the call to fail.");
  return outcome;
}

describe("YouTubeDataApiClient.videos", () => {
  test("asks for the parts the rules need, with the key", async () => {
    await client().videos(["dQw4w9WgXcQ"]);

    const sent = requests[0];
    expect(sent?.searchParams.get("part")).toBe("snippet,contentDetails,status");
    expect(sent?.searchParams.get("id")).toBe("dQw4w9WgXcQ");
    expect(sent?.searchParams.get("key")).toBe(API_KEY);
  });

  test("describes each video in the shape the rules read", async () => {
    const [facts] = await client().videos(["dQw4w9WgXcQ"]);

    expect(facts).toEqual({
      videoId: "dQw4w9WgXcQ",
      title: "Song dQw4w9WgXcQ",
      channelTitle: "Artist - Topic",
      isoDuration: "PT3M5S",
      thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      privacyStatus: "public",
      uploadStatus: "processed",
      embeddable: true,
      liveBroadcastContent: "none",
      ageRestricted: false,
      regionRestriction: null,
    });
  });

  test("asks in batches of 50, the most one request may name", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => videoId(index + 1));

    const facts = await client().videos(ids);

    expect(requests.map((sent) => (sent.searchParams.get("id") ?? "").split(",").length)).toEqual([
      50, 50, 20,
    ]);
    expect(facts).toHaveLength(120);
  });

  test("leaves out the videos YouTube does not answer for", async () => {
    const facts = await client().videos(["dQw4w9WgXcQ", "gone0000001"]);

    expect(facts.map((one) => one.videoId)).toEqual(["dQw4w9WgXcQ"]);
  });

  test("makes no request for no videos", async () => {
    expect(await client().videos([])).toEqual([]);
    expect(requests).toEqual([]);
  });

  test("reports a spent quota as unavailable, without the key", async () => {
    failWith = { status: 403, reason: "quotaExceeded" };

    const failure = await failureOf(() => client().videos(["dQw4w9WgXcQ"]));

    expect(failure).toBeInstanceOf(ProviderUnavailable);
    expect(failure.message).toContain("quota");
    expect(failure.message).not.toContain(API_KEY);
  });

  test("reports any other refusal as unavailable, without the key", async () => {
    failWith = { status: 500, reason: null };

    const failure = await failureOf(() => client().videos(["dQw4w9WgXcQ"]));

    expect(failure).toBeInstanceOf(ProviderUnavailable);
    expect(failure.message).toBe("YouTube answered videos with HTTP 500.");
  });

  test("reports an unreachable YouTube as unavailable, without the URL or key", async () => {
    const offline = new YouTubeDataApiClient({ apiKey: API_KEY, baseUrl: "http://127.0.0.1:1/v3" });

    const failure = await failureOf(() => offline.videos(["dQw4w9WgXcQ"]));

    expect(failure).toBeInstanceOf(ProviderUnavailable);
    expect(failure.message).not.toContain(API_KEY);
    expect(failure.message).not.toContain("127.0.0.1");
  });
});

describe("YouTubeDataApiClient — item parsing", () => {
  async function parse(extra: Record<string, unknown>) {
    const original = videoItem("dQw4w9WgXcQ", extra);
    const local = Bun.serve({ port: 0, fetch: () => Response.json({ items: [original] }) });
    try {
      return await new YouTubeDataApiClient({
        apiKey: API_KEY,
        baseUrl: local.url.origin,
      }).videos(["dQw4w9WgXcQ"]);
    } finally {
      void local.stop(true);
    }
  }

  test("reads an age restriction", async () => {
    const [facts] = await parse({
      contentDetails: { duration: "PT3M", contentRating: { ytRating: "ytAgeRestricted" } },
    });

    expect(facts?.ageRestricted).toBe(true);
  });

  test("reads a region allow-list, including an empty one", async () => {
    const [facts] = await parse({
      contentDetails: { duration: "PT3M", regionRestriction: { allowed: [] } },
    });

    expect(facts?.regionRestriction).toEqual({ allowed: [] });
  });

  test("reads a region block-list", async () => {
    const [facts] = await parse({
      contentDetails: { duration: "PT3M", regionRestriction: { blocked: ["EE"] } },
    });

    expect(facts?.regionRestriction).toEqual({ blocked: ["EE"] });
  });

  test("treats an item missing its status as not found rather than guessing", async () => {
    expect(await parse({ status: undefined })).toEqual([]);
  });

  test("never treats a missing embeddable flag as embeddable", async () => {
    const [facts] = await parse({ status: { privacyStatus: "public", uploadStatus: "processed" } });

    expect(facts?.embeddable).toBe(false);
  });
});

describe("YouTubeDataApiClient.playlistPages", () => {
  /** Every page the adapter hands out, read to the end. */
  async function allPages(playlistId: string): Promise<string[][]> {
    const pages: string[][] = [];
    for await (const page of client().playlistPages(playlistId)) pages.push(page);
    return pages;
  }

  test("hands out every page of a playlist in order, 50 at a time", async () => {
    playlistLength = 120;

    const pages = await allPages("PLmine");

    expect(pages.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(pages.flat()[0]).toBe(videoId(1));
    expect(pages.flat()[119]).toBe(videoId(120));
    expect(requests).toHaveLength(3);
  });

  test("follows YouTube's page tokens", async () => {
    playlistLength = 120;

    await allPages("PLmine");

    expect(requests.map((request) => request.searchParams.get("pageToken"))).toEqual([
      null,
      "1",
      "2",
    ]);
  });

  /** A huge playlist must cost no more quota than its reader needs. */
  test("asks for no page nobody reads", async () => {
    playlistLength = 1000;

    for await (const page of client().playlistPages("PLhuge")) {
      if (page.length > 0) break;
    }

    expect(requests).toHaveLength(1);
  });

  test("asks for nothing until the first page is wanted", () => {
    playlistLength = 3;

    client().playlistPages("PLmine");

    expect(requests).toHaveLength(0);
  });

  test("asks for contentDetails, 50 at a time, for the named playlist", async () => {
    playlistLength = 3;

    await allPages("PLmine");

    expect(requests[0]?.searchParams.get("part")).toBe("contentDetails");
    expect(requests[0]?.searchParams.get("maxResults")).toBe("50");
    expect(requests[0]?.searchParams.get("playlistId")).toBe("PLmine");
  });

  test("reports a missing playlist as PlaylistNotFound", async () => {
    await expect(allPages("PLmissing")).rejects.toThrow(PlaylistNotFound);
  });

  test("reports a private playlist as PlaylistNotFound", async () => {
    failWith = { status: 403, reason: "playlistItemsNotAccessible" };

    await expect(allPages("PLprivate")).rejects.toThrow(PlaylistNotFound);
  });
});
