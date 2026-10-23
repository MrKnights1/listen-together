import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { SESSION_ENDED_CLOSE_CODE } from "@/modules/room/contract/closeCodes.ts";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { SystemClock } from "@/shared/infrastructure/SystemClock.ts";
import { SystemTimers } from "@/shared/infrastructure/SystemTimers.ts";
import {
  AccessList,
  Hosts,
  FindUsers,
  GetSessionUser,
  LogOut,
  SqliteGuestRepository,
  SqliteSessionRepository,
  SqliteUserRepository,
  WebCryptoTokenGenerator,
} from "@/modules/identity/index.ts";
import { AddFromLink } from "@/modules/room/application/AddFromLink.ts";
import { ControlRoom } from "@/modules/room/application/ControlRoom.ts";
import { DescribePeople } from "@/modules/room/application/DescribePeople.ts";
import { GetRoomView } from "@/modules/room/application/GetRoomView.ts";
import { PauseEmptyRoom } from "@/modules/room/application/PauseEmptyRoom.ts";
import { RoomEngine } from "@/modules/room/application/RoomEngine.ts";
import { MAX_MESSAGE_BYTES, type ServerMessage } from "@/modules/room/contract/messages.ts";
import { emptyRoom } from "@/modules/room/domain/RoomState.ts";
import { RoomSockets } from "@/modules/room/http/RoomSockets.ts";
import { createRoomSocketRoute } from "@/modules/room/http/socketRoute.ts";
import { IdentityPeopleDirectory } from "@/modules/room/infrastructure/IdentityPeopleDirectory.ts";
import { MathRandom } from "@/modules/room/infrastructure/MathRandom.ts";
import { SqliteActivityRepository } from "@/modules/room/infrastructure/persistence/SqliteActivityRepository.ts";
import { SqliteRoomRepository } from "@/modules/room/infrastructure/persistence/SqliteRoomRepository.ts";
import {
  RecordingPasteLog,
  SequenceIds,
  StubTrackSource,
  trackInfo,
} from "@/modules/room/tests/support/fakes.ts";

/**
 * The room's live connection end to end: a real server, real WebSockets, real
 * sessions in SQLite, the real engine. Only the catalog is stubbed, because
 * reaching it means reaching YouTube.
 */
const ORIGIN = "http://localhost:3000";
const ADA = { id: "user-ada", discordId: "80351110224678912", token: "ada-session-token" };
const BOB = { id: "user-bob", discordId: "123456789012345678", token: "bob-session-token" };

let server: Server<unknown>;
let db: Database;
let logOut: LogOut;
let sockets: RoomSockets;
let source: StubTrackSource;
const open: WebSocket[] = [];

function seed(person: typeof ADA, name: string): void {
  const hash = new WebCryptoTokenGenerator().hash(person.token);
  db.query(
    "INSERT INTO users (id, discord_id, username, global_name, created_at, last_login_at) VALUES (?, ?, ?, ?, 0, 0)",
  ).run(person.id, person.discordId, name.toLowerCase(), name);
  db.query(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(hash, person.id, Date.now(), Date.now() + 86_400_000);
}

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  seed(ADA, "Ada");
  seed(BOB, "Bob");

  const clock = new SystemClock();
  const timers = new SystemTimers();
  const users = new SqliteUserRepository(db);
  const sessions = new SqliteSessionRepository(db);
  const tokens = new WebCryptoTokenGenerator();
  const getSessionUser = new GetSessionUser(
    sessions,
    users,
    new AccessList(Hosts.of([ADA.discordId, BOB.discordId]), new SqliteGuestRepository(db)),
    tokens,
    clock,
  );
  logOut = new LogOut(sessions, tokens);

  const activity = new SqliteActivityRepository(db);
  const engine = new RoomEngine({
    rooms: new SqliteRoomRepository(db),
    activity,
    clock,
    timers,
    random: new MathRandom(),
  });
  engine.load(emptyRoom(), []);
  source = new StubTrackSource();
  const describePeople = new DescribePeople(new IdentityPeopleDirectory(new FindUsers(users)));
  const pauseEmptyRoom = new PauseEmptyRoom(engine, timers);
  sockets = new RoomSockets({
    getSessionUser,
    engine,
    addFromLink: new AddFromLink(source, engine, new SequenceIds(), new RecordingPasteLog()),
    controlRoom: new ControlRoom(engine),
    getRoomView: new GetRoomView(engine, activity, describePeople),
    describePeople,
    pauseEmptyRoom,
    clock,
    timers,
  });
  logOut.onSessionEnded((token) => sockets.closeForSession(token));

  server = Bun.serve({
    port: 0,
    websocket: sockets.handler,
    routes: {
      "/api/room/socket": { GET: createRoomSocketRoute({ getSessionUser, allowedOrigin: ORIGIN }) },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
});

afterEach(async () => {
  for (const ws of open.splice(0)) ws.close();
  await server.stop(true);
  db.close();
});

/** A browser tab: its socket, every message it received, and how it closed. */
interface Tab {
  ws: WebSocket;
  messages: ServerMessage[];
  closed: Promise<number>;
  next<T extends ServerMessage["t"]>(
    type: T,
    where?: (message: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>>;
}

function tab(cookie: string | null, origin: string | null = ORIGIN): Tab {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers["Cookie"] = `mp_session=${cookie}`;
  if (origin !== null) headers["Origin"] = origin;
  const ws = new WebSocket(`ws://localhost:${server.port}/api/room/socket`, {
    headers,
  } as unknown as string[]);
  open.push(ws);

  const messages: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  ws.onmessage = (event) => {
    messages.push(JSON.parse(String(event.data)) as ServerMessage);
    for (const wake of waiters.splice(0)) wake();
  };
  const closed = new Promise<number>((resolve) => {
    ws.onclose = (event) => resolve(event.code);
  });

  return {
    ws,
    messages,
    closed,
    next(type, where = () => true) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`no ${type} arrived`)), 2000);
        const look = () => {
          const found = messages.find(
            (message) => message.t === type && where(message as never),
          ) as Extract<ServerMessage, { t: typeof type }> | undefined;
          if (found !== undefined) {
            clearTimeout(timeout);
            resolve(found);
          } else waiters.push(look);
        };
        look();
      });
    },
  };
}

async function handshake(headers: Record<string, string>): Promise<number> {
  const response = await fetch(`http://localhost:${server.port}/api/room/socket`, {
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      ...headers,
    },
  });
  return response.status;
}

describe("the room socket", () => {
  test("refuses a handshake from another origin, even with a good session", async () => {
    expect(
      await handshake({ Cookie: `mp_session=${ADA.token}`, Origin: "https://evil.example" }),
    ).toBe(400);
  });

  test("refuses a handshake that names no origin", async () => {
    expect(await handshake({ Cookie: `mp_session=${ADA.token}` })).toBe(400);
  });

  test("refuses a handshake without a session", async () => {
    expect(await handshake({ Origin: ORIGIN })).toBe(401);
  });

  test("welcomes a signed-in friend with the room", async () => {
    const ada = tab(ADA.token);

    const welcome = await ada.next("welcome");

    expect(welcome.you).toBe(ADA.id);
    expect(welcome.room.state.version).toBe(0);
    expect(welcome.listeners.map((one) => one.userId)).toEqual([ADA.id]);
  });

  test("one person's command reaches everyone, names attached", async () => {
    source.link("youtu.be/x", [trackInfo("one")]);
    const ada = tab(ADA.token);
    const bob = tab(BOB.token);
    await ada.next("welcome");
    await bob.next("welcome");

    ada.ws.send(
      JSON.stringify({ t: "cmd", id: "c1", op: { type: "add", url: "youtu.be/x", scope: "song" } }),
    );

    const update = await bob.next("ev");
    expect(update.by).toBe(ADA.id);
    expect(update.tracks.map((track) => track.title)).toEqual(["Song one"]);
    const listeners = await bob.next("listeners", (message) => message.people.length === 2);
    expect(listeners.people.map((person) => person.name).sort()).toEqual(["Ada", "Bob"]);
    expect((await ada.next("ack")).result?.added).toBe(1);
  });

  test("answers a clock ping", async () => {
    const ada = tab(ADA.token);
    await ada.next("welcome");
    const before = Date.now();

    ada.ws.send(JSON.stringify({ t: "ping", id: 1, c: 42 }));

    const pong = await ada.next("pong");
    expect(pong.c).toBe(42);
    expect(pong.s).toBeGreaterThanOrEqual(before);
  });

  /**
   * Bun refuses the frame before any handler sees it and closes with 1009
   * (Message Too Big).
   */
  test("drops a connection that sends more than a message may hold, unread", async () => {
    const ada = tab(ADA.token);
    await ada.next("welcome");

    ada.ws.send(JSON.stringify({ t: "resync", pad: "x".repeat(MAX_MESSAGE_BYTES) }));

    expect(await ada.closed).toBe(1009);
    expect(ada.messages.filter((message) => message.t === "snapshot")).toEqual([]);
    expect(sockets.count).toBe(0);
  });

  test("signing out closes that person's socket at once", async () => {
    const ada = tab(ADA.token);
    const bob = tab(BOB.token);
    await ada.next("welcome");
    await bob.next("welcome");

    await logOut.execute(ADA.token);

    expect(await ada.closed).toBe(SESSION_ENDED_CLOSE_CODE);
    expect(sockets.count).toBe(1);
  });
});
