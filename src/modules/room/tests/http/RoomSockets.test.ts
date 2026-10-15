import { beforeEach, describe, expect, test } from "bun:test";
import {
  NOT_ALLOWED_CLOSE_CODE,
  SESSION_ENDED_CLOSE_CODE,
} from "@/modules/room/contract/closeCodes.ts";
import { AddFromLink } from "@/modules/room/application/AddFromLink.ts";
import { ControlRoom } from "@/modules/room/application/ControlRoom.ts";
import { DescribePeople } from "@/modules/room/application/DescribePeople.ts";
import { GetRoomView } from "@/modules/room/application/GetRoomView.ts";
import { PauseEmptyRoom } from "@/modules/room/application/PauseEmptyRoom.ts";
import { RoomEngine } from "@/modules/room/application/RoomEngine.ts";
import type { ServerMessage } from "@/modules/room/contract/messages.ts";
import { EMPTY_ROOM_PAUSE_MS } from "@/modules/room/domain/limits.ts";
import { emptyRoom } from "@/modules/room/domain/RoomState.ts";
import {
  RoomSockets,
  type RoomSocket,
  type SessionChecker,
} from "@/modules/room/http/RoomSockets.ts";
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
import { ScriptedRandom } from "@/modules/room/tests/support/room.ts";

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

/** Stands in for Bun's socket: records what it was sent, and closes the way Bun does. */
class FakeSocket implements RoomSocket {
  readonly sent: ServerMessage[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | null = null;

  constructor(
    readonly data: RoomSocket["data"],
    private readonly sockets: () => RoomSockets,
  ) {}

  send(message: string): void {
    this.sent.push(JSON.parse(message) as ServerMessage);
  }

  close(code?: number, reason?: string): void {
    if (this.closedWith !== null) return;
    this.closedWith = { code, reason };
    void this.sockets().handler.close(this);
  }

  last<T extends ServerMessage["t"]>(type: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.sent.filter((message) => message.t === type).at(-1) as
      Extract<ServerMessage, { t: T }> | undefined;
  }

  all<T extends ServerMessage["t"]>(type: T): Extract<ServerMessage, { t: T }>[] {
    return this.sent.filter((message) => message.t === type) as Extract<ServerMessage, { t: T }>[];
  }
}

let clock: FakeClock;
let timers: ManualTimers;
let source: StubTrackSource;
let engine: RoomEngine;
let sockets: RoomSockets;
/** Session token → what identity would answer. */
let sessions: Map<string, Awaited<ReturnType<SessionChecker["execute"]>>>;
let nextConn = 0;

beforeEach(() => {
  clock = new FakeClock(NOW);
  timers = new ManualTimers(clock);
  source = new StubTrackSource();
  const activity = new InMemoryActivityRepository();
  engine = new RoomEngine({
    rooms: new InMemoryRoomRepository(),
    activity,
    clock,
    timers,
    random: new ScriptedRandom(),
  });
  engine.load(emptyRoom(), []);
  const describePeople = new DescribePeople(
    new InMemoryPeopleDirectory({ ada: "Ada", bob: "Bob" }),
  );
  sessions = new Map([
    ["ada-token", { status: "signed_in", user: { id: "ada" } }],
    ["bob-token", { status: "signed_in", user: { id: "bob" } }],
  ]);
  sockets = new RoomSockets({
    getSessionUser: {
      execute: async (token) => sessions.get(token ?? "") ?? { status: "signed_out" },
    },
    engine,
    addFromLink: new AddFromLink(source, engine, new SequenceIds()),
    controlRoom: new ControlRoom(engine),
    getRoomView: new GetRoomView(engine, activity, describePeople),
    describePeople,
    pauseEmptyRoom: new PauseEmptyRoom(engine, timers),
    clock,
    timers,
  });
});

async function connect(userId: string, expiresAt = NOW + 30 * DAY): Promise<FakeSocket> {
  nextConn += 1;
  const ws = new FakeSocket(
    { connId: `conn-${nextConn}`, userId, sessionToken: `${userId}-token`, expiresAt },
    () => sockets,
  );
  await sockets.handler.open(ws);
  return ws;
}

async function say(ws: FakeSocket, message: unknown): Promise<void> {
  await sockets.handler.message(ws, JSON.stringify(message));
}

describe("joining", () => {
  test("welcomes a newcomer with the whole room, who they are, and who is here", async () => {
    source.link("x", [trackInfo("one")]);
    const ada = await connect("ada");
    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });

    const bob = await connect("bob");

    const welcome = bob.last("welcome");
    expect(welcome?.you).toBe("bob");
    expect(welcome?.s).toBe(NOW);
    expect(welcome?.room.state.current?.entryId).toBe("entry-1");
    expect(welcome?.room.tracks.map((track) => track.title)).toEqual(["Song one"]);
    expect(welcome?.room.people.map((person) => person.name).sort()).toEqual(["Ada", "Bob"]);
    expect(welcome?.listeners.map((one) => one.userId).sort()).toEqual(["ada", "bob"]);
  });

  test("tells everyone already here that someone joined", async () => {
    const ada = await connect("ada");

    await connect("bob");

    expect(
      ada
        .last("listeners")
        ?.people.map((person) => person.name)
        .sort(),
    ).toEqual(["Ada", "Bob"]);
  });
});

describe("commands", () => {
  test("a link is queued, acknowledged with what it did, and everybody hears about it", async () => {
    source.link("x", [trackInfo("one"), trackInfo("two")]);
    const ada = await connect("ada");
    const bob = await connect("bob");

    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });

    expect(ada.last("ack")).toEqual({
      t: "ack",
      id: "c1",
      result: { added: 2, duplicates: 0, overflow: 0, skipped: [], truncated: false },
    });
    const update = bob.last("ev");
    expect(update?.v).toBe(1);
    expect(update?.by).toBe("ada");
    expect(update?.tracks.map((track) => track.trackId)).toEqual(["youtube:one", "youtube:two"]);
  });

  test("the person's choice of song or playlist reaches the catalog", async () => {
    source.link("x", [trackInfo("one")]);
    const ada = await connect("ada");

    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "playlist" } });

    expect(source.scopes).toEqual(["playlist"]);
  });

  test("a link that adds nothing is refused with the reason", async () => {
    source.rejectWith = "playlist_not_found";
    const ada = await connect("ada");

    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });

    expect(ada.last("nack")).toEqual({ t: "nack", id: "c1", code: "playlist_not_found" });
  });

  test("anyone may skip for everyone", async () => {
    source.link("x", [trackInfo("one"), trackInfo("two")]);
    const ada = await connect("ada");
    const bob = await connect("bob");
    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });

    await say(bob, { t: "cmd", id: "c2", op: { type: "skip", entryId: "entry-1" } });

    expect(bob.last("ack")).toEqual({ t: "ack", id: "c2", result: null });
    expect(ada.last("ev")?.events).toEqual([{ type: "advanced", reason: "skipped", at: NOW }]);
  });

  test("a command aimed at a song that has moved on is refused as stale", async () => {
    const ada = await connect("ada");

    await say(ada, { t: "cmd", id: "c1", op: { type: "skip", entryId: "long-gone" } });

    expect(ada.last("nack")).toEqual({ t: "nack", id: "c1", code: "stale" });
  });

  test("a malformed message is refused without touching anything", async () => {
    const ada = await connect("ada");

    await sockets.handler.message(ada, "{not json");

    expect(ada.last("nack")).toEqual({ t: "nack", id: "", code: "invalid" });
  });

  test("one link at a time per person", async () => {
    let release: () => void = () => undefined;
    source.link("slow", [trackInfo("one")]);
    const original = source.resolve.bind(source);
    source.resolve = async (pasted, scope) => {
      await new Promise<void>((resolve) => (release = resolve));
      return await original(pasted, scope);
    };
    const ada = await connect("ada");

    const first = say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "slow", scope: "song" } });
    await say(ada, { t: "cmd", id: "c2", op: { type: "add", url: "slow", scope: "song" } });
    release();
    await first;

    expect(ada.all("nack")).toEqual([{ t: "nack", id: "c2", code: "busy" }]);
    expect(ada.last("ack")?.id).toBe("c1");
  });

  test("past six links a minute, a person is told to slow down", async () => {
    source.rejectWith = "unsupported_url";
    const ada = await connect("ada");

    for (let i = 1; i <= 7; i += 1)
      await say(ada, { t: "cmd", id: `c${i}`, op: { type: "add", url: "x", scope: "song" } });

    expect(ada.last("nack")).toEqual({ t: "nack", id: "c7", code: "rate_limited" });
  });
});

describe("the clock and presence", () => {
  test("answers a ping with the server's time, echoing the browser's", async () => {
    const ada = await connect("ada");
    clock.set(NOW + 1234);

    await say(ada, { t: "ping", id: 1, c: 99.5 });

    expect(ada.last("pong")).toEqual({ t: "pong", id: 1, c: 99.5, s: NOW + 1234 });
  });

  test("shares each person's listening and sync status with everyone", async () => {
    const ada = await connect("ada");
    const bob = await connect("bob");

    await say(bob, { t: "presence", listening: true, sync: "error", errorCode: 150 });

    expect(ada.last("listeners")?.listeners).toContainEqual({
      userId: "bob",
      listening: true,
      sync: "error",
      errorCode: 150,
    });
  });

  test("shows a person as listening if any of their tabs is", async () => {
    const ada = await connect("ada");
    await connect("ada");
    await say(ada, { t: "presence", listening: true, sync: "in_sync", errorCode: null });

    const lines = ada.last("listeners")?.listeners.filter((one) => one.userId === "ada");

    expect(lines).toEqual([{ userId: "ada", listening: true, sync: "in_sync", errorCode: null }]);
  });
});

describe("sessions", () => {
  test("a command from a session that ended closes the socket and does nothing", async () => {
    source.link("x", [trackInfo("one")]);
    const ada = await connect("ada");
    sessions.set("ada-token", { status: "signed_out" });

    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });

    expect(ada.closedWith?.code).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(engine.snapshot().state.current).toBeNull();
    expect(sockets.count).toBe(0);
  });

  test("someone taken off the whitelist is closed with a code that says so", async () => {
    const ada = await connect("ada");
    sessions.set("ada-token", { status: "not_allowed" });

    await say(ada, { t: "cmd", id: "c1", op: { type: "repeat", mode: "all" } });

    expect(ada.closedWith?.code).toBe(NOT_ALLOWED_CLOSE_CODE);
  });

  test("signing out closes exactly that session's sockets", async () => {
    const ada = await connect("ada");
    const adaAgain = await connect("ada");
    const bob = await connect("bob");

    expect(sockets.closeForSession("ada-token")).toBe(2);

    expect(ada.closedWith?.code).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(adaAgain.closedWith?.code).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(bob.closedWith).toBeNull();
  });

  test("taking somebody off the guest list closes every socket they have, and only theirs", async () => {
    const ada = await connect("ada");
    const adaAgain = await connect("ada");
    const bob = await connect("bob");

    expect(sockets.closeForUser("ada")).toBe(2);

    expect(ada.closedWith?.code).toBe(NOT_ALLOWED_CLOSE_CODE);
    expect(adaAgain.closedWith?.code).toBe(NOT_ALLOWED_CLOSE_CODE);
    expect(bob.closedWith).toBeNull();
  });

  test("a socket is closed the moment its session expires", async () => {
    const ada = await connect("ada", NOW + 5000);
    const bob = await connect("bob", NOW + 60_000);

    await timers.advanceTo(NOW + 5000);

    expect(ada.closedWith?.code).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(bob.closedWith).toBeNull();

    await timers.advanceTo(NOW + 60_000);
    expect(bob.closedWith?.code).toBe(SESSION_ENDED_CLOSE_CODE);
  });
});

describe("an empty room", () => {
  test("pauses a minute after the last person leaves, and not before", async () => {
    source.link("x", [trackInfo("one", 10 * EMPTY_ROOM_PAUSE_MS)]);
    const ada = await connect("ada");
    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });

    ada.close(1000, "bye");
    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS - 1);
    expect(engine.snapshot().state.current?.status).toBe("playing");

    await timers.advanceTo(NOW + EMPTY_ROOM_PAUSE_MS);
    expect(engine.snapshot().state.current?.status).toBe("paused");
  });

  test("keeps playing if someone comes back within the minute", async () => {
    source.link("x", [trackInfo("one", 10 * EMPTY_ROOM_PAUSE_MS)]);
    const ada = await connect("ada");
    await say(ada, { t: "cmd", id: "c1", op: { type: "add", url: "x", scope: "song" } });
    ada.close(1000, "reload");

    await connect("ada");
    await timers.advanceTo(NOW + 2 * EMPTY_ROOM_PAUSE_MS);

    expect(engine.snapshot().state.current?.status).toBe("playing");
  });

  test("closing everyone at shutdown uses the code given", async () => {
    const ada = await connect("ada");
    const bob = await connect("bob");

    sockets.closeAll(1001, "restarting");

    expect([ada.closedWith?.code, bob.closedWith?.code]).toEqual([1001, 1001]);
  });
});
