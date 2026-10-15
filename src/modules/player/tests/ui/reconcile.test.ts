import { describe, expect, test } from "bun:test";
import {
  CORRECTION_COOLDOWN_MS,
  freshMemory,
  IN_SYNC_MS,
  LOAD_LEAD_MS,
  OUT_OF_SYNC_AFTER,
  reconcile,
  SEEK_LEAD_MS,
  STALL_MS,
  type PlayerView,
  type SyncMemory,
  type Target,
} from "@/modules/player/ui/reconcile.ts";

const playing = (positionMs: number, overrides: Partial<Target> = {}): Target => ({
  provider: "youtube",
  providerTrackId: "song1",
  playing: true,
  positionMs,
  durationMs: 200_000,
  setAt: 0,
  ...overrides,
});
const paused = (positionMs: number) => playing(positionMs, { playing: false });
const view = (overrides: Partial<PlayerView> = {}): PlayerView => ({
  providerTrackId: "song1",
  state: "playing",
  positionMs: 0,
  error: null,
  ...overrides,
});

describe("reconcile — not listening, or nothing to play", () => {
  test("stays silent before the listener presses Start listening", () => {
    expect(
      reconcile(playing(5000), view({ state: "playing" }), false, freshMemory(), 0),
    ).toMatchObject({
      actions: [{ type: "pause" }],
      status: "idle",
    });
  });

  test("goes quiet when the room goes idle", () => {
    expect(reconcile(null, view({ state: "playing" }), true, freshMemory(), 0)).toMatchObject({
      actions: [{ type: "pause" }],
      status: "idle",
    });
  });

  test("does nothing at all when idle and already quiet", () => {
    expect(reconcile(null, view({ state: "paused" }), true, freshMemory(), 0).actions).toEqual([]);
  });
});

describe("reconcile — a different song", () => {
  test("loads the room's song where the room is, a little ahead to cover loading", () => {
    const step = reconcile(
      playing(42_000),
      view({ providerTrackId: "old" }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([
      {
        type: "load",
        provider: "youtube",
        providerTrackId: "song1",
        startMs: 42_000 + LOAD_LEAD_MS,
        play: true,
      },
    ]);
    expect(step.status).toBe("catching_up");
  });

  test("cues, without playing, the song of a paused room", () => {
    const step = reconcile(
      paused(42_000),
      view({ providerTrackId: null, state: "unstarted" }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([
      { type: "load", provider: "youtube", providerTrackId: "song1", startMs: 42_000, play: false },
    ]);
  });
});

describe("reconcile — the room is paused", () => {
  test("pauses a playing player and lines it up with the room", () => {
    const step = reconcile(
      paused(60_000),
      view({ state: "playing", positionMs: 61_000 }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([{ type: "pause" }, { type: "seek", positionMs: 60_000 }]);
    expect(step.status).toBe("in_sync");
  });

  test("leaves an already-aligned paused player alone", () => {
    expect(
      reconcile(
        paused(60_000),
        view({ state: "paused", positionMs: 60_100 }),
        true,
        freshMemory(),
        0,
      ).actions,
    ).toEqual([]);
  });
});

describe("reconcile — the room is playing", () => {
  test("is in sync within a second, and does nothing", () => {
    const step = reconcile(
      playing(60_000),
      view({ positionMs: 60_000 + IN_SYNC_MS }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([]);
    expect(step.status).toBe("in_sync");
  });

  test("starts a paused player, jumping first if it is far off", () => {
    const step = reconcile(
      playing(60_000),
      view({ state: "paused", positionMs: 10_000 }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([
      { type: "seek", positionMs: 60_000 + SEEK_LEAD_MS },
      { type: "play" },
    ]);
  });

  test("corrects a drift over a second by seeking a little ahead", () => {
    const step = reconcile(
      playing(60_000),
      view({ positionMs: 58_000 }),
      true,
      freshMemory(),
      10_000,
    );

    expect(step.actions).toEqual([{ type: "seek", positionMs: 60_000 + SEEK_LEAD_MS }]);
    expect(step.status).toBe("catching_up");
  });

  test("waits out the cooldown before correcting again", () => {
    const first = reconcile(
      playing(60_000),
      view({ positionMs: 58_000 }),
      true,
      freshMemory(),
      10_000,
    );

    const soon = reconcile(
      playing(61_000),
      view({ positionMs: 58_500 }),
      true,
      first.memory,
      10_000 + CORRECTION_COOLDOWN_MS - 1,
    );

    expect(soon.actions).toEqual([]);
    expect(soon.status).toBe("catching_up");
  });

  test("follows a jump by the room at once, even right after correcting this player", () => {
    // The room resumes: starting the paused player counts as a correction.
    const resumed = reconcile(
      playing(60_000),
      view({ state: "paused", positionMs: 60_000 }),
      true,
      freshMemory(),
      0,
    );

    // A second later somebody jumps to 2:00, well inside the cooldown.
    const jumped = reconcile(
      playing(120_000, { setAt: 1000 }),
      view({ positionMs: 61_000 }),
      true,
      resumed.memory,
      1000,
    );

    expect(jumped.actions).toEqual([{ type: "seek", positionMs: 120_000 + SEEK_LEAD_MS }]);
  });

  test("follows a second jump made right after the first", () => {
    const first = reconcile(
      playing(120_000, { setAt: 1000 }),
      view({ positionMs: 61_000 }),
      true,
      freshMemory(),
      1000,
    );

    const second = reconcile(
      playing(30_000, { setAt: 2000 }),
      view({ positionMs: 120_500 }),
      true,
      first.memory,
      2000,
    );

    expect(second.actions).toEqual([{ type: "seek", positionMs: 30_000 + SEEK_LEAD_MS }]);
  });

  test("doubles the cooldown with each correction that did not land", () => {
    let memory: SyncMemory = freshMemory();
    const seeksAt: number[] = [];

    for (let second = 0; second < 120; second += 1) {
      const now = second * 1000;
      const step = reconcile(playing(now), view({ positionMs: now - 5000 }), true, memory, now);
      if (step.actions.length > 0) seeksAt.push(now);
      memory = step.memory;
    }

    // 0, then +5 s, +10 s, +20 s, +40 s, +40 s …
    expect(seeksAt.slice(0, 5)).toEqual([0, 5000, 15_000, 35_000, 75_000]);
  });

  test(`calls the listener out of sync after ${OUT_OF_SYNC_AFTER} corrections that did not land`, () => {
    let memory: SyncMemory = freshMemory();
    let last = "";
    for (let second = 0; second <= 40; second += 1) {
      const now = second * 1000;
      const step = reconcile(playing(now), view({ positionMs: now - 5000 }), true, memory, now);
      memory = step.memory;
      last = step.status;
    }

    expect(last).toBe("out_of_sync");
  });

  test("clears the failures once back in sync", () => {
    const drifting: SyncMemory = { ...freshMemory(), failures: 3, lastCorrectionAt: 0 };

    const step = reconcile(playing(60_000), view({ positionMs: 60_200 }), true, drifting, 100_000);

    expect(step.status).toBe("in_sync");
    expect(step.memory.failures).toBe(0);
  });

  /** An ad freezes the song's clock; seeking would only fight it. */
  test("calls a player stuck on 'playing' without moving catching up, and leaves it alone", () => {
    let memory: SyncMemory = freshMemory();
    let step = reconcile(playing(60_000), view({ positionMs: 30_000 }), true, memory, 0);
    memory = { ...step.memory, lastCorrectionAt: null };

    step = reconcile(playing(62_000), view({ positionMs: 30_000 }), true, memory, 1000);
    step = reconcile(
      playing(63_000),
      view({ positionMs: 30_000 }),
      true,
      step.memory,
      1000 + STALL_MS,
    );

    expect(step.actions).toEqual([]);
    expect(step.status).toBe("catching_up");
  });

  test("leaves a buffering player alone", () => {
    expect(
      reconcile(
        playing(60_000),
        view({ state: "buffering", positionMs: 50_000 }),
        true,
        freshMemory(),
        0,
      ),
    ).toMatchObject({
      actions: [],
      status: "catching_up",
    });
  });

  test("does not restart a song that ended a beat before the room moved on", () => {
    const step = reconcile(
      playing(199_500),
      view({ state: "ended", positionMs: 200_000 }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([]);
    expect(step.status).toBe("in_sync");
  });
});

describe("reconcile — a player error", () => {
  test("reports this listener's error and never fights it", () => {
    const step = reconcile(
      playing(60_000),
      view({ state: "unstarted", error: 150 }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions).toEqual([]);
    expect(step.status).toBe("error");
  });

  test("tries again when the room moves to another song", () => {
    const step = reconcile(
      playing(0, { providerTrackId: "song2" }),
      view({ error: 150 }),
      true,
      freshMemory(),
      0,
    );

    expect(step.actions[0]?.type).toBe("load");
  });
});
