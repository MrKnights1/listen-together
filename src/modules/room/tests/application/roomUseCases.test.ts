import { beforeEach, describe, expect, test } from "bun:test";
import { AddFromLink } from "@/modules/room/application/AddFromLink.ts";
import { ControlRoom, type PersonCommand } from "@/modules/room/application/ControlRoom.ts";
import { DescribePeople } from "@/modules/room/application/DescribePeople.ts";
import { GetRoomView } from "@/modules/room/application/GetRoomView.ts";
import { MaintainQueue } from "@/modules/room/application/MaintainQueue.ts";
import { PauseEmptyRoom } from "@/modules/room/application/PauseEmptyRoom.ts";
import { RestoreRoom } from "@/modules/room/application/RestoreRoom.ts";
import { RoomEngine } from "@/modules/room/application/RoomEngine.ts";
import { ACTIVITY_RETENTION_MS } from "@/modules/room/domain/activity.ts";
import { LinkRejected } from "@/modules/room/domain/errors.ts";
import {
  EMPTY_ROOM_PAUSE_MS,
  RESUME_WINDOW_MS,
  TRACK_END_GRACE_MS,
} from "@/modules/room/domain/limits.ts";
import { positionAt } from "@/modules/room/domain/playback.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import {
  FakeClock,
  InMemoryActivityRepository,
  InMemoryPeopleDirectory,
  InMemoryRoomRepository,
  ManualTimers,
  SequenceIds,
  StubTrackSource,
  trackInfo,
} from "@/modules/room/tests/support/fakes.ts";
import { apply, ScriptedRandom } from "@/modules/room/tests/support/room.ts";

const NOW = 1_760_000_000_000;
const SONG = 200_000;

let clock: FakeClock;
let timers: ManualTimers;
let rooms: InMemoryRoomRepository;
let activity: InMemoryActivityRepository;
let source: StubTrackSource;
let engine: RoomEngine;

beforeEach(() => {
  clock = new FakeClock(NOW);
  timers = new ManualTimers(clock);
  rooms = new InMemoryRoomRepository();
  activity = new InMemoryActivityRepository();
  source = new StubTrackSource();
  engine = new RoomEngine({ rooms, activity, clock, timers, random: new ScriptedRandom() });
  engine.load(emptyRoom(), []);
});

const addFromLink = () => new AddFromLink(source, engine, new SequenceIds());
const state = () => engine.snapshot().state;

describe("AddFromLink", () => {
  test("queues a link's playable songs in the person's list and reports it", async () => {
    source.link("youtu.be/x", [trackInfo("one"), trackInfo("two")], {
      skipped: [{ title: "Private song", reason: "private" }],
    });

    const report = await addFromLink().execute("ada", "youtu.be/x", "song");

    expect(report).toEqual({
      added: 2,
      duplicates: 0,
      overflow: 0,
      skipped: [{ title: "Private song", reason: "private" }],
      truncated: false,
    });
    expect(state().entries["entry-1"]?.ownerId).toBe("ada");
    expect(state().current?.entryId).toBe("entry-1");
  });

  test("counts songs already in the person's list as duplicates", async () => {
    source.link("youtu.be/x", [trackInfo("one"), trackInfo("two")]);
    await addFromLink().execute("ada", "youtu.be/x", "song");

    const again = await new AddFromLink(source, engine, new SequenceIds()).execute(
      "ada",
      "youtu.be/x",
      "song",
    );

    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(2);
  });

  test("passes a rejected link through and touches nothing", async () => {
    source.rejectWith = "playlist_not_found";

    await expect(addFromLink().execute("ada", "youtu.be/x", "song")).rejects.toThrow(LinkRejected);
    expect(rooms.saves).toBe(0);
  });

  test("passes the person's choice of song or playlist on to the catalog", async () => {
    source.link("youtu.be/x?list=PL", [trackInfo("one"), trackInfo("two")]);

    await addFromLink().execute("ada", "youtu.be/x?list=PL", "playlist");

    expect(source.scopes).toEqual(["playlist"]);
  });

  test("says when a playlist was cut short", async () => {
    source.link("list", [trackInfo("one")], { truncated: true });

    expect((await addFromLink().execute("ada", "list", "song")).truncated).toBe(true);
  });
});

describe("ControlRoom", () => {
  test("lets anyone in the room skip for everyone", async () => {
    source.link("x", [trackInfo("one"), trackInfo("two")]);
    await addFromLink().execute("ada", "x", "song");

    const decision = await new ControlRoom(engine).execute("bob", {
      type: "skip",
      entryId: "entry-1",
    });

    expect(decision.kind).toBe("accepted");
    expect(state().current?.entryId).toBe("entry-2");
  });

  test("lets anyone clear the queue for everyone, and the feed says how many went", async () => {
    source.link("x", [trackInfo("one"), trackInfo("two"), trackInfo("three")]);
    await addFromLink().execute("ada", "x", "song");

    const decision = await new ControlRoom(engine).execute("bob", {
      type: "clear",
      addedUpTo: NOW,
    });

    expect(decision.kind).toBe("accepted");
    expect(state().queue).toEqual([]);
    expect(state().current?.entryId).toBe("entry-1");
    expect(activity.all().at(-1)).toMatchObject({
      actorId: "bob",
      kind: "cleared",
      detail: { count: 2 },
    });
  });

  test("refuses the room's own commands if a message ever smuggles one in", async () => {
    const smuggled = { type: "auto_pause" } as unknown as PersonCommand;

    expect(await new ControlRoom(engine).execute("bob", smuggled)).toEqual({
      kind: "rejected",
      code: "invalid",
    });
  });
});

describe("RestoreRoom", () => {
  function playingRoom(): RoomState {
    return apply(emptyRoom(), {
      type: "add",
      ownerId: "ada",
      tracks: [
        { entryId: "e1", trackId: "youtube:one", durationMs: SONG },
        { entryId: "e2", trackId: "youtube:two", durationMs: SONG },
      ],
    });
  }

  beforeEach(() => {
    source.known.set("youtube:one", trackInfo("one"));
    source.known.set("youtube:two", trackInfo("two"));
  });

  const restore = () => new RestoreRoom(rooms, source, engine, clock).execute();

  test("starts an empty room when nothing was ever saved", async () => {
    expect(await restore()).toEqual(emptyRoom());
  });

  /** A deploy: the music carries on on its original timing, as if nothing happened. */
  test("carries on playing after a clean shutdown moments ago", async () => {
    rooms.stored = { state: playingRoom(), savedAt: NOW + 60_000, cleanShutdown: true };
    clock.set(NOW + 60_000 + RESUME_WINDOW_MS - 1);

    const restored = await restore();

    expect(restored.current?.status).toBe("playing");
    expect(positionAt(restored, clock.ms)).toBe(clock.ms - NOW);
  });

  test("moves straight on if the song ended while the server was down", async () => {
    rooms.stored = { state: playingRoom(), savedAt: NOW + SONG - 1000, cleanShutdown: true };
    clock.set(NOW + SONG + 5000);

    await restore();
    await timers.advanceTo(clock.ms);

    expect(state().current?.entryId).toBe("e2");
  });

  test("comes back paused, where it was last saved, after a crash", async () => {
    rooms.stored = { state: playingRoom(), savedAt: NOW + 30_000, cleanShutdown: false };
    clock.set(NOW + 31_000);

    const restored = await restore();

    expect(restored.current?.status).toBe("paused");
    expect(positionAt(restored, clock.ms + 999_999)).toBe(30_000);
  });

  test("comes back paused after a clean shutdown that was too long ago", async () => {
    rooms.stored = { state: playingRoom(), savedAt: NOW + 30_000, cleanShutdown: true };
    clock.set(NOW + 30_000 + RESUME_WINDOW_MS);

    expect((await restore()).current?.status).toBe("paused");
  });

  test("uses up the clean-shutdown mark, so a later crash is not mistaken for a deploy", async () => {
    rooms.stored = { state: playingRoom(), savedAt: NOW, cleanShutdown: true };
    clock.set(NOW + 1000);

    await restore();

    expect(rooms.stored?.cleanShutdown).toBe(false);
  });

  test("knows the songs it brought back", async () => {
    rooms.stored = { state: playingRoom(), savedAt: NOW, cleanShutdown: true };

    await restore();

    expect(
      engine
        .snapshot()
        .tracks.map((track) => track.title)
        .sort(),
    ).toEqual(["Song one", "Song two"]);
  });
});

describe("PauseEmptyRoom", () => {
  beforeEach(async () => {
    source.link("x", [trackInfo("one", 10 * EMPTY_ROOM_PAUSE_MS)]);
    await addFromLink().execute("ada", "x", "song");
  });

  test("pauses the room a minute after the last listener leaves", async () => {
    const pause = new PauseEmptyRoom(engine, timers);
    pause.listenersChanged(0);

    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS - 1);
    expect(state().current?.status).toBe("playing");

    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS);
    expect(state().current?.status).toBe("paused");
    expect(activity.all().at(-1)?.kind).toBe("auto_paused");
  });

  test("does not pause if somebody comes back in time", async () => {
    const pause = new PauseEmptyRoom(engine, timers);
    pause.listenersChanged(0);
    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS / 2);

    pause.listenersChanged(1);
    await timers.advanceTo(NOW + 2 * EMPTY_ROOM_PAUSE_MS);

    expect(state().current?.status).toBe("playing");
  });

  test("a second 'empty' while already counting down does not restart the minute", async () => {
    const pause = new PauseEmptyRoom(engine, timers);
    pause.listenersChanged(0);
    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS / 2);
    pause.listenersChanged(0);

    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS);

    expect(state().current?.status).toBe("paused");
  });
});

describe("MaintainQueue", () => {
  test("removes queued songs that can no longer play, and tells the catalog what is in use", async () => {
    source.link("x", [trackInfo("one"), trackInfo("two"), trackInfo("three")]);
    await addFromLink().execute("ada", "x", "song");
    source.unplayable = ["youtube:two"];

    const result = await new MaintainQueue(engine, source, activity, clock).execute();

    expect(source.maintainedWith).toEqual([["youtube:one", "youtube:three", "youtube:two"]]);
    expect(result.removed).toBe(1);
    expect(Object.values(state().entries).map((entry) => entry.trackId)).not.toContain(
      "youtube:two",
    );
    expect(activity.all().at(-1)).toMatchObject({
      actorId: null,
      kind: "auto_removed",
      detail: { title: "Song two" },
    });
  });

  test("trims the activity feed to 30 days", async () => {
    await activity.record({
      at: NOW - ACTIVITY_RETENTION_MS - 1,
      actorId: null,
      kind: "paused",
      detail: {},
    });
    await activity.record({ at: NOW, actorId: null, kind: "paused", detail: {} });

    expect(
      (await new MaintainQueue(engine, source, activity, clock).execute()).purgedActivity,
    ).toBe(1);
  });
});

describe("GetRoomView", () => {
  test("gives a newcomer the room, its songs, the recent feed and the people in it", async () => {
    source.link("x", [trackInfo("one")]);
    await addFromLink().execute("ada", "x", "song");
    const people = new InMemoryPeopleDirectory({ ada: "Ada", bob: "Bob", cy: "Cy" });

    const view = await new GetRoomView(engine, activity, new DescribePeople(people)).execute([
      "bob",
    ]);

    expect(view.state.current?.entryId).toBe("entry-1");
    expect(view.tracks.map((track) => track.title)).toEqual(["Song one"]);
    expect(view.activity.map((entry) => entry.kind)).toEqual(["added"]);
    expect(view.people.map((person) => person.name).sort()).toEqual(["Ada", "Bob"]);
  });

  test("asks about each person once, however often they appear", async () => {
    source.link("x", [trackInfo("one"), trackInfo("two")]);
    await addFromLink().execute("ada", "x", "song");
    const people = new InMemoryPeopleDirectory({ ada: "Ada" });

    await new GetRoomView(engine, activity, new DescribePeople(people)).execute(["ada"]);

    expect(people.asked).toEqual([["ada"]]);
  });
});

describe("the end-of-song grace", () => {
  test("is a whole second, covering YouTube's whole-second durations", () => {
    expect(TRACK_END_GRACE_MS).toBe(1000);
  });
});
