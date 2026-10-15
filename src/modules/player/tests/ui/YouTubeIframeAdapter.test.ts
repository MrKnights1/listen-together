import { describe, expect, test } from "bun:test";
import {
  IFRAME_API_SRC,
  loadYouTubeIframeApi,
  type IframeApiHost,
  type YTNamespace,
  type YTPlayer,
  type YTPlayerOptions,
} from "@/modules/player/ui/youtube/iframeApi.ts";
import {
  PLAYER_SIZE_PX,
  YouTubeIframeAdapter,
} from "@/modules/player/ui/youtube/YouTubeIframeAdapter.ts";
import type { PlayerState } from "@/modules/player/ui/PlayerAdapter.ts";

/** YouTube's `YT` global, played by a recorder: the browser API is the boundary. */
class FakeYTPlayer implements YTPlayer {
  static last: FakeYTPlayer | null = null;
  readonly calls: unknown[] = [];
  time = 0;
  stateCode = -1;

  constructor(
    readonly mount: HTMLElement,
    readonly options: YTPlayerOptions,
  ) {
    FakeYTPlayer.last = this;
  }

  loadVideoById(options: unknown) {
    this.calls.push(["loadVideoById", options]);
  }
  cueVideoById(options: unknown) {
    this.calls.push(["cueVideoById", options]);
  }
  playVideo() {
    this.calls.push(["playVideo"]);
  }
  pauseVideo() {
    this.calls.push(["pauseVideo"]);
  }
  seekTo(seconds: number, ahead: boolean) {
    this.calls.push(["seekTo", seconds, ahead]);
  }
  setVolume(volume: number) {
    this.calls.push(["setVolume", volume]);
  }
  mute() {
    this.calls.push(["mute"]);
  }
  unMute() {
    this.calls.push(["unMute"]);
  }
  getCurrentTime() {
    return this.time;
  }
  getPlayerState() {
    return this.stateCode;
  }
  destroy() {
    this.calls.push(["destroy"]);
  }
}

const YT: YTNamespace = { Player: FakeYTPlayer };
const mount = {} as HTMLElement;

async function adapter(events: Partial<Parameters<typeof YouTubeIframeAdapter.create>[3]> = {}) {
  const creating = YouTubeIframeAdapter.create(YT, mount, "https://music.example.com", {
    onStateChange: () => undefined,
    onError: () => undefined,
    onAutoplayBlocked: () => undefined,
    ...events,
  });
  FakeYTPlayer.last?.options.events.onReady();
  return { adapter: await creating, yt: FakeYTPlayer.last as FakeYTPlayer };
}

describe("YouTubeIframeAdapter", () => {
  test("makes a 200×200 player with our controls, not YouTube's", async () => {
    const { yt } = await adapter();

    expect(yt.options.width).toBe(PLAYER_SIZE_PX);
    expect(yt.options.height).toBe(PLAYER_SIZE_PX);
    expect(yt.options.playerVars).toMatchObject({
      controls: 0,
      disablekb: 1,
      playsinline: 1,
      enablejsapi: 1,
      origin: "https://music.example.com",
    });
  });

  test("loads to play, or cues to wait, from a position in seconds", async () => {
    const { adapter: player, yt } = await adapter();

    player.load("dQw4w9WgXcQ", 42_500, true);
    player.load("dQw4w9WgXcQ", 1000, false);

    expect(yt.calls).toEqual([
      ["loadVideoById", { videoId: "dQw4w9WgXcQ", startSeconds: 42.5 }],
      ["cueVideoById", { videoId: "dQw4w9WgXcQ", startSeconds: 1 }],
    ]);
  });

  test("seeks in seconds, fetching ahead of what is buffered", async () => {
    const { adapter: player, yt } = await adapter();

    player.seekTo(90_250);

    expect(yt.calls).toEqual([["seekTo", 90.25, true]]);
  });

  test("reports position in whole milliseconds", async () => {
    const { adapter: player, yt } = await adapter();
    yt.time = 12.3456;

    expect(player.positionMs()).toBe(12_346);
  });

  test.each([
    [-1, "unstarted"],
    [0, "ended"],
    [1, "playing"],
    [2, "paused"],
    [3, "buffering"],
    [5, "cued"],
    [42, "unstarted"],
  ] as [number, PlayerState][])("reads YouTube state %d as %s", async (code, state) => {
    const { adapter: player, yt } = await adapter();
    yt.stateCode = code;

    expect(player.state()).toBe(state);
  });

  test("keeps volume a whole number from 0 to 100, and mutes separately", async () => {
    const { adapter: player, yt } = await adapter();

    player.setVolume(150);
    player.setVolume(33.6);
    player.setMuted(true);
    player.setMuted(false);

    expect(yt.calls).toEqual([["setVolume", 100], ["setVolume", 34], ["mute"], ["unMute"]]);
  });

  test("passes YouTube's events on in its own words", async () => {
    const seen: unknown[] = [];
    const { yt } = await adapter({
      onStateChange: (state) => seen.push(["state", state]),
      onError: (code) => seen.push(["error", code]),
      onAutoplayBlocked: () => seen.push(["blocked"]),
    });

    yt.options.events.onStateChange({ data: 1 });
    yt.options.events.onError({ data: 150 });
    yt.options.events.onAutoplayBlocked();

    expect(seen).toEqual([["state", "playing"], ["error", 150], ["blocked"]]);
  });
});

describe("loadYouTubeIframeApi", () => {
  test("adds YouTube's script once and resolves when it says it is ready", async () => {
    const host: IframeApiHost = {};
    const scripts: string[] = [];

    const first = loadYouTubeIframeApi(host, (src) => scripts.push(src));
    const second = loadYouTubeIframeApi(host, (src) => scripts.push(src));
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();

    expect(await first).toBe(YT);
    expect(await second).toBe(YT);
    expect(scripts).toEqual([IFRAME_API_SRC]);
  });

  test("uses the API straight away if the page already has it", async () => {
    const scripts: string[] = [];

    expect(await loadYouTubeIframeApi({ YT }, (src) => scripts.push(src))).toBe(YT);
    expect(scripts).toEqual([]);
  });

  test("keeps any ready callback the page already had", async () => {
    let called = false;
    const host: IframeApiHost = { onYouTubeIframeAPIReady: () => (called = true) };

    const loading = loadYouTubeIframeApi(host, () => undefined);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();
    await loading;

    expect(called).toBe(true);
  });
});
