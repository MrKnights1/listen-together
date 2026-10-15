import { beforeEach, describe, expect, test } from "bun:test";
import type { SyncStatus, Target } from "@/modules/player/ui/reconcile.ts";
import { SyncedPlayer } from "@/modules/player/ui/SyncedPlayer.ts";
import { FakeAdapter } from "@/modules/player/tests/support/fakes.ts";

let now: number;
let target: Target | null;
let adapters: FakeAdapter[];
let statuses: [SyncStatus, number | null][];
let blocked: number;
let player: SyncedPlayer;

beforeEach(() => {
  now = 0;
  target = {
    provider: "youtube",
    providerTrackId: "song1",
    playing: true,
    positionMs: 10_000,
    durationMs: 200_000,
    setAt: 0,
  };
  adapters = [];
  statuses = [];
  blocked = 0;
  player = new SyncedPlayer({
    createAdapter: async (_provider, events) => {
      const adapter = new FakeAdapter(events);
      adapters.push(adapter);
      return adapter;
    },
    target: () => target,
    now: () => now,
    onStatus: (status, errorCode) => statuses.push([status, errorCode]),
    onAutoplayBlocked: () => {
      blocked += 1;
    },
  });
});

/** Lets the adapter's creation promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SyncedPlayer", () => {
  test("makes no player and no sound until the listener starts listening", async () => {
    player.tick();
    await settle();

    expect(adapters).toEqual([]);
    expect(statuses.at(-1)).toEqual(["idle", null]);
  });

  test("creates the player on Start listening, then loads the room's song", async () => {
    player.setListening(true);
    await settle();

    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.calls).toEqual(["load song1 @10500 play"]);
  });

  test("applies this listener's volume to the player as soon as it exists", async () => {
    player.setAudio(35, true);
    player.setListening(true);
    await settle();

    expect(adapters[0]?.volume).toBe(35);
    expect(adapters[0]?.muted).toBe(true);
  });

  test("follows the room to the next song", async () => {
    player.setListening(true);
    await settle();
    target = {
      provider: "youtube",
      providerTrackId: "song2",
      playing: true,
      positionMs: 0,
      durationMs: 1000,
      setAt: 1,
    };

    player.tick();

    expect(adapters[0]?.calls.at(-1)).toBe("load song2 @500 play");
  });

  test("reports a YouTube error for this listener only, and recovers on the next song", async () => {
    player.setListening(true);
    await settle();

    adapters[0]?.events.onError(150);
    expect(statuses.at(-1)).toEqual(["error", 150]);

    target = {
      provider: "youtube",
      providerTrackId: "song2",
      playing: true,
      positionMs: 0,
      durationMs: 1000,
      setAt: 1,
    };
    player.tick();
    expect(statuses.at(-1)?.[0]).toBe("catching_up");
  });

  test("stops and asks for a click when the browser blocks sound", async () => {
    player.setListening(true);
    await settle();

    adapters[0]?.events.onAutoplayBlocked();

    expect(blocked).toBe(1);
    expect(statuses.at(-1)).toEqual(["idle", null]);
  });

  test("reports each status once, not on every tick", async () => {
    player.setListening(true);
    await settle();
    player.tick(); // the load landed: catching up becomes in sync, which is news
    const before = statuses.length;

    player.tick();
    player.tick();

    expect(statuses.at(-1)).toEqual(["in_sync", null]);
    expect(statuses.length).toBe(before);
  });

  test("resync forgets everything and loads afresh", async () => {
    player.setListening(true);
    await settle();

    player.resync();

    expect(adapters[0]?.calls.filter((call) => call.startsWith("load"))).toHaveLength(2);
  });

  test("tears the player down when destroyed", async () => {
    player.setListening(true);
    await settle();

    player.destroy();

    expect(adapters[0]?.destroyed).toBe(true);
  });
});
