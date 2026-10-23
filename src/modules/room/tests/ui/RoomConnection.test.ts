import { beforeEach, describe, expect, test } from "bun:test";
import {
  NOT_ALLOWED_CLOSE_CODE,
  SESSION_ENDED_CLOSE_CODE,
} from "@/modules/room/contract/closeCodes.ts";
import type { ServerMessage } from "@/modules/room/contract/messages.ts";
import {
  RoomConnection,
  type ConnectionState,
  type SocketLike,
} from "@/modules/room/ui/RoomConnection.ts";
import { FakeClock, ManualTimers } from "@/modules/room/tests/support/fakes.ts";

/** The browser's WebSocket, played by a recorder the test drives. */
class FakeSocket implements SocketLike {
  readonly sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  opened = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  /** As the browser does: a socket still connecting cannot be written to. */
  send(data: string): void {
    if (!this.opened) throw new Error("InvalidStateError: Still in CONNECTING state.");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number): void {
    this.closedWith = code ?? 1000;
  }

  open(): void {
    this.opened = true;
    this.onopen?.();
  }

  receive(message: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

let clock: FakeClock;
let timers: ManualTimers;
let sockets: FakeSocket[];
let states: ConnectionState[];
let messages: ServerMessage[];
let pongs: [number, number, number][];
let connection: RoomConnection;

const welcome: ServerMessage = {
  t: "welcome",
  s: 0,
  you: "ada",
  room: {
    state: {
      version: 0,
      entries: {},
      queue: [],
      current: null,
      repeat: "off",
      shuffle: false,
      starred: [],
    },
    tracks: [],
    activity: [],
    people: [],
  },
  listeners: [],
};

beforeEach(() => {
  clock = new FakeClock(0);
  timers = new ManualTimers(clock);
  sockets = [];
  states = [];
  messages = [];
  pongs = [];
  connection = new RoomConnection({
    open: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => clock.ms,
    schedule: (ms, run) => timers.after(ms, run),
    onMessage: (message) => messages.push(message),
    onPong: (sentAt, receivedAt, serverTime) => pongs.push([sentAt, receivedAt, serverTime]),
    onState: (state) => states.push(state),
  });
  connection.start();
});

const socket = () => sockets.at(-1) as FakeSocket;

function open(): FakeSocket {
  socket().open();
  socket().receive(welcome);
  return socket();
}

describe("RoomConnection", () => {
  test("joins, and says when it is in", () => {
    open();

    expect(states).toEqual(["connecting", "open"]);
    expect(messages.map((message) => message.t)).toEqual(["welcome"]);
  });

  test("pings five times quickly to line up the clock, then once a minute", async () => {
    const live = open();

    await timers.advanceTo(1200);
    expect(live.sent.filter((message) => message["t"] === "ping")).toHaveLength(5);

    await timers.advanceTo(60_000);
    expect(live.sent.filter((message) => message["t"] === "ping")).toHaveLength(6);
  });

  test("coming back to the tab re-measures the clock, but still pings only once a minute after", async () => {
    const live = open();
    await timers.advanceTo(10_000);

    connection.wake();
    await timers.advanceTo(20_000);
    connection.wake();
    await timers.advanceTo(30_000);
    connection.wake();
    await timers.advanceTo(31_200);
    const afterWakes = live.sent.filter((message) => message["t"] === "ping").length;
    expect(afterWakes).toBe(20);

    await timers.advanceTo(31_200 + 5 * 60_000);
    expect(live.sent.filter((message) => message["t"] === "ping")).toHaveLength(afterWakes + 5);
    expect(timers.pending).toBe(1);
  });

  test("coming back to the tab while disconnected sends nothing, and the next line pings as usual", async () => {
    open();
    socket().onclose?.({ code: 1006 });

    connection.wake();
    await timers.advanceTo(1000);
    const next = open();
    await timers.advanceTo(1000 + 3 * 60_000);

    expect(next.sent.filter((message) => message["t"] === "ping")).toHaveLength(5 + 3);
  });

  test("hands each pong back with when it was sent and when it came back", async () => {
    const live = open();
    await timers.advanceTo(0);
    const [ping] = live.sent;

    clock.set(40);
    live.receive({ t: "pong", id: ping?.["id"] as number, c: 0, s: 9_000 });

    expect(pongs).toEqual([[0, 40, 9_000]]);
  });

  test("matches each command to its answer", async () => {
    const live = open();

    const skip = connection.command({ type: "skip", entryId: "e1" });
    const sent = live.sent.find((message) => message["t"] === "cmd");
    live.receive({ t: "nack", id: sent?.["id"] as string, code: "stale" });

    expect(await skip).toEqual({ ok: false, code: "stale" });
  });

  test("gives up on a command nobody answers", async () => {
    open();

    const waiting = connection.command({ type: "skip", entryId: "e1" });
    await timers.advanceTo(120_000);

    expect(await waiting).toEqual({ ok: false, code: "disconnected" });
  });

  /** A room-filling playlist takes most of a minute to read from YouTube. */
  test("keeps waiting for a slow add well past a minute", async () => {
    const live = open();

    const adding = connection.command({ type: "add", url: "x", scope: "playlist" });
    await timers.advanceTo(90_000);
    const sent = live.sent.find((message) => message["t"] === "cmd");
    live.receive({ t: "ack", id: sent?.["id"] as string, result: null });

    expect(await adding).toEqual({ ok: true, result: null });
  });

  test("reconnects after a drop, waiting longer each time it fails", async () => {
    open();
    socket().onclose?.({ code: 1006 });
    expect(states.at(-1)).toBe("reconnecting");

    await timers.advanceTo(1000);
    expect(sockets).toHaveLength(2);
    socket().onclose?.({ code: 1006 });

    await timers.advanceTo(2999);
    expect(sockets).toHaveLength(2);
    await timers.advanceTo(3000);
    expect(sockets).toHaveLength(3);
  });

  test("answers outstanding commands as disconnected when the line drops", async () => {
    open();
    const waiting = connection.command({ type: "skip", entryId: "e1" });

    socket().onclose?.({ code: 1006 });

    expect(await waiting).toEqual({ ok: false, code: "disconnected" });
  });

  test.each([
    [SESSION_ENDED_CLOSE_CODE, "signed_out"],
    [NOT_ALLOWED_CLOSE_CODE, "not_allowed"],
  ] as const)("stops for good on close code %d (%s)", async (code, state) => {
    open();

    socket().onclose?.({ code });
    await timers.advanceTo(120_000);

    expect(states.at(-1)).toBe(state);
    expect(sockets).toHaveLength(1);
  });

  test("tells the room this listener's status only when it changed, and again after a reconnect", async () => {
    const first = open();
    connection.setPresence({ listening: true, sync: "in_sync", errorCode: null });
    connection.setPresence({ listening: true, sync: "in_sync", errorCode: null });
    expect(first.sent.filter((message) => message["t"] === "presence")).toHaveLength(1);

    first.onclose?.({ code: 1006 });
    await timers.advanceTo(1000);
    const second = open();

    expect(second.sent.filter((message) => message["t"] === "presence")).toEqual([
      { t: "presence", listening: true, sync: "in_sync", errorCode: null },
    ]);
  });

  /** The page reports its status on its first render, before the socket has opened. */
  test("holds this listener's status until the room has welcomed it", () => {
    connection.setPresence({ listening: false, sync: "idle", errorCode: null });

    const live = open();

    expect(live.sent.filter((message) => message["t"] === "presence")).toEqual([
      { t: "presence", listening: false, sync: "idle", errorCode: null },
    ]);
  });

  test("refuses a command while still connecting rather than sending it into nothing", async () => {
    const outcome = await connection.command({ type: "skip", entryId: "e1" });

    expect(outcome).toEqual({ ok: false, code: "disconnected" });
    expect(socket().sent).toEqual([]);
  });

  test("asking to catch up before the socket opens is harmless: the welcome is the whole room", () => {
    connection.resync();

    expect(open().sent.filter((message) => message["t"] === "resync")).toEqual([]);
  });

  test("closes politely and stays closed when the page leaves", async () => {
    const live = open();

    connection.stop();
    await timers.advanceTo(120_000);

    expect(live.closedWith).toBe(1000);
    expect(sockets).toHaveLength(1);
  });
});
