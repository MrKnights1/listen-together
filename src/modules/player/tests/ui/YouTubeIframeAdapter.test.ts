import { describe, expect, test } from "bun:test";
import {
  IFRAME_API_SRC,
  IFRAME_API_TIMEOUT_MS,
  loadYouTubeIframeApi,
  type After,
  type IframeApiHost,
  type YTNamespace,
  type YTPlayer,
  type YTPlayerOptions,
} from "@/modules/player/ui/youtube/iframeApi.ts";
import {
  PLAYER_READY_TIMEOUT_MS,
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
  volume = 100;
  muted = false;

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
    this.volume = volume;
  }
  mute() {
    this.muted = true;
  }
  /** Measured on the real player: unmuting at volume 0 raises it to 5. */
  unMute() {
    this.muted = false;
    if (this.volume === 0) this.volume = 5;
  }
  isMuted() {
    return this.muted;
  }
  /** What the listener actually hears. */
  get audible() {
    return this.muted ? 0 : this.volume;
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

/** Timers that fire only when the test says so. */
class ManualAfter {
  readonly pending = new Map<number, { ms: number; run: () => void }>();
  private nextId = 0;

  readonly after: After = (ms, run) => {
    const id = (this.nextId += 1);
    this.pending.set(id, { ms, run });
    return () => this.pending.delete(id);
  };

  fireAll(): void {
    const due = [...this.pending.values()];
    this.pending.clear();
    for (const timer of due) timer.run();
  }
}

const noEvents = {
  onStateChange: () => undefined,
  onError: () => undefined,
  onAutoplayBlocked: () => undefined,
};

async function adapter(events: Partial<Parameters<typeof YouTubeIframeAdapter.create>[3]> = {}) {
  const creating = YouTubeIframeAdapter.create(
    YT,
    mount,
    "https://music.example.com",
    { ...noEvents, ...events },
    new ManualAfter().after,
  );
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

  test("keeps volume a whole number from 0 to 100", async () => {
    const { adapter: player, yt } = await adapter();

    player.setAudio(150, false);
    expect(yt.audible).toBe(100);
    player.setAudio(33.6, false);
    expect(yt.audible).toBe(34);
  });

  /** The bug: YouTube's unMute() lifts a volume of 0 back to 5. */
  test("dragging the slider to 0 is silent", async () => {
    const { adapter: player, yt } = await adapter();

    player.setAudio(60, false);
    player.setAudio(0, false);

    expect(yt.audible).toBe(0);
  });

  test("coming back up from 0 plays at the chosen volume, never a stray 5", async () => {
    const { adapter: player, yt } = await adapter();

    player.setAudio(0, false);
    player.setAudio(30, false);

    expect(yt.muted).toBe(false);
    expect(yt.volume).toBe(30);
  });

  test("the mute button silences, and unmuting brings the volume back", async () => {
    const { adapter: player, yt } = await adapter();

    player.setAudio(50, true);
    expect(yt.audible).toBe(0);

    player.setAudio(50, false);
    expect(yt.audible).toBe(50);
  });

  test("unmuting while the slider is at 0 stays silent", async () => {
    const { adapter: player, yt } = await adapter();

    player.setAudio(50, true);
    player.setAudio(0, true);
    player.setAudio(0, false);

    expect(yt.audible).toBe(0);
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

  test("gives up, and takes the player down, when it never gets ready", async () => {
    const timers = new ManualAfter();
    const creating = YouTubeIframeAdapter.create(
      YT,
      mount,
      "https://x.example",
      noEvents,
      timers.after,
    );
    const yt = FakeYTPlayer.last as FakeYTPlayer;

    expect([...timers.pending.values()].map((timer) => timer.ms)).toEqual([
      PLAYER_READY_TIMEOUT_MS,
    ]);
    timers.fireAll();

    await expect(creating).rejects.toThrow("did not get ready in time");
    expect(yt.calls).toContainEqual(["destroy"]);
  });

  test("stops watching the clock once the player is ready", async () => {
    const timers = new ManualAfter();
    const creating = YouTubeIframeAdapter.create(
      YT,
      mount,
      "https://x.example",
      noEvents,
      timers.after,
    );
    FakeYTPlayer.last?.options.events.onReady();
    await creating;

    expect(timers.pending.size).toBe(0);
  });
});

describe("loadYouTubeIframeApi", () => {
  test("adds YouTube's script once and resolves when it says it is ready", async () => {
    const host: IframeApiHost = {};
    const scripts: string[] = [];

    const timers = new ManualAfter();
    const first = loadYouTubeIframeApi(host, (src) => scripts.push(src), timers.after);
    const second = loadYouTubeIframeApi(host, (src) => scripts.push(src), timers.after);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();

    expect(await first).toBe(YT);
    expect(await second).toBe(YT);
    expect(scripts).toEqual([IFRAME_API_SRC]);
    expect(timers.pending.size).toBe(0);
  });

  test("uses the API straight away if the page already has it", async () => {
    const scripts: string[] = [];

    expect(
      await loadYouTubeIframeApi({ YT }, (src) => scripts.push(src), new ManualAfter().after),
    ).toBe(YT);
    expect(scripts).toEqual([]);
  });

  test("keeps any ready callback the page already had", async () => {
    let called = false;
    const host: IframeApiHost = { onYouTubeIframeAPIReady: () => (called = true) };

    const loading = loadYouTubeIframeApi(host, () => undefined, new ManualAfter().after);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();
    await loading;

    expect(called).toBe(true);
  });

  test("fails when the script does not load, and a later call adds it again", async () => {
    const host: IframeApiHost = {};
    const failures: (() => void)[] = [];
    const scripts: string[] = [];
    const addScript = (src: string, onError: () => void) => {
      scripts.push(src);
      failures.push(onError);
    };

    const first = loadYouTubeIframeApi(host, addScript, new ManualAfter().after);
    failures[0]?.();
    await expect(first).rejects.toThrow("did not load");

    const second = loadYouTubeIframeApi(host, addScript, new ManualAfter().after);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();

    expect(await second).toBe(YT);
    expect(scripts).toEqual([IFRAME_API_SRC, IFRAME_API_SRC]);
  });

  test("fails cleanly even when the script reports its error at once", async () => {
    const loading = loadYouTubeIframeApi({}, (_src, onError) => onError(), new ManualAfter().after);

    await expect(loading).rejects.toThrow("did not load");
  });

  test("fails when the script never says it is ready, and puts the page's callback back", async () => {
    const pageCallback = () => undefined;
    const host: IframeApiHost = { onYouTubeIframeAPIReady: pageCallback };
    const timers = new ManualAfter();

    const loading = loadYouTubeIframeApi(host, () => undefined, timers.after);
    expect([...timers.pending.values()].map((timer) => timer.ms)).toEqual([IFRAME_API_TIMEOUT_MS]);
    timers.fireAll();

    await expect(loading).rejects.toThrow("in time");
    expect(host.onYouTubeIframeAPIReady).toBe(pageCallback);
  });

  test("clears a half-loaded YT, which would stop YouTube's script from running again", async () => {
    // YouTube's script leaves `{ loading: 1 }` behind when its second file fails, and skips
    // its whole setup while that is there.
    const host = { YT: { loading: 1 } } as unknown as IframeApiHost;
    const scripts: string[] = [];

    const loading = loadYouTubeIframeApi(host, (src) => scripts.push(src), new ManualAfter().after);

    expect(host.YT).toBeUndefined();
    expect(scripts).toEqual([IFRAME_API_SRC]);
    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();
    expect(await loading).toBe(YT);
  });

  test("waits for the Player itself, not just the YT object", async () => {
    const host: IframeApiHost = {};
    const loading = loadYouTubeIframeApi(host, () => undefined, new ManualAfter().after);
    let done = false;
    void loading.then(() => (done = true));

    host.YT = {} as YTNamespace;
    host.onYouTubeIframeAPIReady?.();
    await Promise.resolve();
    expect(done).toBe(false);

    host.YT = YT;
    host.onYouTubeIframeAPIReady?.();
    expect(await loading).toBe(YT);
  });
});
