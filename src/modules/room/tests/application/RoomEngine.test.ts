import { beforeEach, describe, expect, test } from "bun:test";
import { RoomEngine, type RoomUpdate } from "@/modules/room/application/RoomEngine.ts";
import { RoomSuspended } from "@/modules/room/domain/errors.ts";
import { TRACK_END_GRACE_MS } from "@/modules/room/domain/limits.ts";
import { positionAt } from "@/modules/room/domain/playback.ts";
import { emptyRoom } from "@/modules/room/domain/RoomState.ts";
import {
  FakeClock,
  InMemoryActivityRepository,
  InMemoryRoomRepository,
  ManualTimers,
  trackInfo,
} from "@/modules/room/tests/support/fakes.ts";
import { ScriptedRandom } from "@/modules/room/tests/support/room.ts";

const NOW = 1_760_000_000_000;
const SONG = 200_000;

let clock: FakeClock;
let timers: ManualTimers;
let rooms: InMemoryRoomRepository;
let activity: InMemoryActivityRepository;
let engine: RoomEngine;
let updates: RoomUpdate[];

beforeEach(() => {
  clock = new FakeClock(NOW);
  timers = new ManualTimers(clock);
  rooms = new InMemoryRoomRepository();
  activity = new InMemoryActivityRepository();
  engine = new RoomEngine({ rooms, activity, clock, timers, random: new ScriptedRandom() });
  engine.load(emptyRoom(), []);
  updates = [];
  engine.subscribe((update) => updates.push(update));
});

async function add(ownerId: string, ...names: string[]) {
  const tracks = names.map((name) => trackInfo(name, SONG));
  return await engine.execute(
    {
      type: "add",
      ownerId,
      tracks: tracks.map((track) => ({
        entryId: `${ownerId}-${track.providerTrackId}`,
        trackId: track.trackId,
        durationMs: track.durationMs,
      })),
    },
    ownerId,
    tracks,
  );
}

const current = () => engine.snapshot().state.current;

describe("RoomEngine", () => {
  test("applies a command, saves it, and announces it", async () => {
    await add("ada", "one");

    expect(current()?.entryId).toBe("ada-one");
    expect(rooms.stored?.state.current?.entryId).toBe("ada-one");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.version).toBe(1);
    expect(updates[0]?.actorId).toBe("ada");
    expect(updates[0]?.tracks.map((track) => track.trackId)).toEqual(["youtube:one"]);
  });

  /** A change nobody could recover after a crash must never be shown to anyone. */
  test("changes nothing and tells nobody when the save fails", async () => {
    rooms.failNextSave = true;

    await expect(add("ada", "one")).rejects.toThrow("disk full");

    expect(current()).toBeNull();
    expect(updates).toEqual([]);
    expect(activity.all()).toEqual([]);
  });

  test("saves and announces nothing for a command that changed nothing", async () => {
    await add("ada", "one");
    const saves = rooms.saves;

    await engine.execute({ type: "repeat", mode: "off" }, "ada", []);

    expect(rooms.saves).toBe(saves);
    expect(updates).toHaveLength(1);
  });

  test("hands back a refusal without saving or announcing", async () => {
    await add("ada", "one");

    const decision = await engine.execute({ type: "skip", entryId: "not-playing" }, "bob", []);

    expect(decision).toEqual({ kind: "rejected", code: "stale" });
    expect(updates).toHaveLength(1);
  });

  test("records who did what in the activity feed", async () => {
    await add("ada", "one", "two");
    await engine.execute({ type: "skip", entryId: "ada-one" }, "bob", []);

    expect(activity.all().map((entry) => [entry.actorId, entry.kind, entry.detail])).toEqual([
      ["ada", "added", { count: 2 }],
      ["bob", "skipped", { trackId: "youtube:one", title: "Song one" }],
    ]);
    expect(updates[1]?.activity?.kind).toBe("skipped");
  });

  test("forgets what it knew about songs that left the room", async () => {
    await add("ada", "one", "two");
    await engine.execute({ type: "skip", entryId: "ada-one" }, "ada", []);

    expect(engine.snapshot().tracks.map((track) => track.trackId)).toEqual(["youtube:two"]);
  });

  test("applies concurrent commands one after the other", async () => {
    await add("ada", "one", "two", "three");

    const [first, second] = await Promise.all([
      engine.execute({ type: "skip", entryId: "ada-one" }, "bob", []),
      engine.execute({ type: "skip", entryId: "ada-one" }, "cy", []),
    ]);

    // Both saw "one" playing; only the first skip can still mean that song.
    expect(first.kind).toBe("accepted");
    expect(second).toEqual({ kind: "rejected", code: "stale" });
    expect(current()?.entryId).toBe("ada-two");
  });
});

describe("RoomEngine — the end-of-song alarm", () => {
  test("starts the next song when the current one ends, a grace second after", async () => {
    await add("ada", "one", "two");

    await timers.advanceTo(NOW + SONG + TRACK_END_GRACE_MS - 1);
    expect(current()?.entryId).toBe("ada-one");

    await timers.advanceTo(NOW + SONG + TRACK_END_GRACE_MS);
    expect(current()?.entryId).toBe("ada-two");
    expect(current()?.anchorAt).toBe(NOW + SONG + TRACK_END_GRACE_MS);
  });

  test("keeps exactly one alarm, re-aimed after every change", async () => {
    await add("ada", "one", "two");
    await add("bob", "three");
    await engine.execute({ type: "seek", entryId: "ada-one", positionMs: 150_000 }, "ada", []);

    expect(timers.pending).toBe(1);
    expect(timers.nextAt).toBe(NOW + (SONG - 150_000) + TRACK_END_GRACE_MS);
  });

  test("a paused room has no alarm, and resuming sets it again", async () => {
    await add("ada", "one", "two");
    clock.set(NOW + 50_000);
    await engine.execute({ type: "pause", entryId: "ada-one" }, "ada", []);
    expect(timers.pending).toBe(0);

    clock.set(NOW + 500_000);
    await engine.execute({ type: "resume", entryId: "ada-one" }, "ada", []);

    expect(timers.nextAt).toBe(NOW + 500_000 + (SONG - 50_000) + TRACK_END_GRACE_MS);
  });

  test("plays through the whole queue on its own, then goes idle", async () => {
    await add("ada", "one", "two");
    await add("bob", "three");

    await timers.advanceTo(NOW + 10 * SONG);

    expect(current()).toBeNull();
    expect(timers.pending).toBe(0);
    expect(updates.at(-1)?.events).toEqual([
      { type: "advanced", reason: "ended", next: null, at: NOW + 3 * (SONG + TRACK_END_GRACE_MS) },
    ]);
  });

  test("records nothing in the feed for a song simply ending", async () => {
    await add("ada", "one", "two");

    await timers.advanceTo(NOW + SONG + TRACK_END_GRACE_MS);

    expect(activity.all().map((entry) => entry.kind)).toEqual(["added"]);
  });
});

describe("RoomEngine.suspend", () => {
  test("saves the room as cleanly shut down and stops the alarm", async () => {
    await add("ada", "one");
    clock.set(NOW + 30_000);

    await engine.suspend();

    expect(rooms.stored?.cleanShutdown).toBe(true);
    expect(rooms.stored?.savedAt).toBe(NOW + 30_000);
    expect(timers.pending).toBe(0);
  });

  test("takes no more commands afterwards", async () => {
    await engine.suspend();

    await expect(add("ada", "one")).rejects.toThrow(RoomSuspended);
  });

  test("lets a command already running finish and be saved first", async () => {
    const adding = add("ada", "one");
    const suspending = engine.suspend();
    await Promise.all([adding, suspending]);

    expect(rooms.stored?.state.current?.entryId).toBe("ada-one");
    expect(rooms.stored?.cleanShutdown).toBe(true);
  });

  test("keeps the paused position exact for whoever restores it", async () => {
    await add("ada", "one");
    clock.set(NOW + 42_000);
    await engine.execute({ type: "pause", entryId: "ada-one" }, "ada", []);

    await engine.suspend();

    expect(positionAt(rooms.stored?.state ?? emptyRoom(), NOW + 999_999)).toBe(42_000);
  });
});
