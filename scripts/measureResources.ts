/**
 * Runs the server as production does (`bun --smol`, APP_ENV=production) on a
 * throwaway database, and measures it: a while alone, then a while with three
 * listeners who each send a command every ten seconds. Fails if any target is
 * missed.
 *
 *   bun run measure          both scenarios
 *   bun run measure base     a room of a few songs: a minute alone, five with listeners
 *   bun run measure full     the room full to its 5000 songs, from the moment it boots
 *
 * Memory is the resident set (VmRSS); CPU is the process's user + system time
 * against the wall clock, as a percentage of one core. People, sessions, songs
 * and the full room are seeded, and the server never sees the developer's
 * .env, so nothing calls Discord or YouTube.
 */
import type { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClientMessage, CommandOp, ServerMessage } from "@/modules/room/contract/messages.ts";
import {
  commit,
  emptyRoom,
  MAX_ROOM_ENTRIES,
  SqliteRoomRepository,
  type QueueEntry,
  type RoomState,
} from "@/modules/room/index.ts";
import { emptyClientRoom, receive, type ClientRoom } from "@/modules/room/ui/clientRoom.ts";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";

const MB = 1024 * 1024;

export type Targets = Record<keyof Summary, number>;

export const TARGETS: Targets = {
  idleRssMb: 60,
  busyRssMb: 75,
  idleCpuPercent: 0.5,
  busyCpuPercent: 1,
  growthMb: 5,
};

export interface Sample {
  /** Seconds since measuring began. */
  at: number;
  rssBytes: number;
  /** Mean CPU over the second before this sample, in percent of one core. */
  cpuPercent: number;
}

/** User plus system time, in clock ticks, from a /proc/<pid>/stat line. */
export function cpuTicks(statLine: string): number {
  // The process name sits in parentheses and may itself hold spaces or ")":
  // the fields are counted from the last ")".
  const fields = statLine.slice(statLine.lastIndexOf(")") + 2).split(" ");
  // utime and stime are fields 14 and 15 of the line; the 3rd field is the first after the name.
  return Number(fields[11]) + Number(fields[12]);
}

/** The resident set, in bytes, from /proc/<pid>/status. */
export function rssBytes(status: string): number {
  const match = /^VmRSS:\s+(\d+) kB$/m.exec(status);
  if (match === null) throw new Error("No VmRSS line: the process has exited");
  return Number(match[1]) * 1024;
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export interface Summary {
  idleRssMb: number;
  busyRssMb: number;
  idleCpuPercent: number;
  busyCpuPercent: number;
  /** The last half-minute of the busy phase against its first. */
  growthMb: number;
}

/** Mean resident set per whole minute, in MB: a leak climbs steadily, warming up levels off. */
export function rssByMinute(samples: Sample[]): number[] {
  const minutes: number[] = [];
  for (let start = 0; start + 60 <= samples.length; start += 60) {
    minutes.push(mean(samples.slice(start, start + 60).map((sample) => sample.rssBytes)) / MB);
  }
  return minutes;
}

export function summarize(idle: Sample[], busy: Sample[]): Summary {
  if (idle.length === 0 || busy.length < 60) throw new Error("Too few samples to judge");
  const busyRss = busy.map((sample) => sample.rssBytes);
  return {
    idleRssMb: Math.max(...idle.map((sample) => sample.rssBytes)) / MB,
    busyRssMb: Math.max(...busyRss) / MB,
    idleCpuPercent: mean(idle.map((sample) => sample.cpuPercent)),
    busyCpuPercent: mean(busy.map((sample) => sample.cpuPercent)),
    growthMb: (mean(busyRss.slice(-30)) - mean(busyRss.slice(0, 30))) / MB,
  };
}

export function verdicts(
  summary: Summary,
  targets: Targets,
): { name: keyof Summary; value: number; limit: number; ok: boolean }[] {
  return (Object.keys(targets) as (keyof Summary)[]).map((name) => ({
    name,
    value: summary[name],
    limit: targets[name],
    ok: summary[name] <= targets[name],
  }));
}

// --- The run ---------------------------------------------------------------

const PORT = 3319;
const APP_URL = "https://measure.invalid";
/** Stands in for the API key: Google refuses it, so even a stray call could not spend quota. */
export const PLACEHOLDER_YOUTUBE_KEY = "unused-when-measuring";
const COMMAND_EVERY_MS = 10_000;
const LISTENERS = ["measure-ada", "measure-bob", "measure-cy"];
const discordIdOf = (index: number) => `8035111022467891${index}`;
export const SONG_IDS = Array.from(
  { length: 40 },
  (_, index) => `measure${String(index).padStart(4, "0")}`,
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The command line and the whole environment of the measured server. Built
 * from constants alone, bar PATH: the developer's .env and their real keys
 * never reach it.
 */
export function serverProcess(
  databasePath: string,
  parentEnv: Record<string, string | undefined>,
): { cmd: string[]; env: Record<string, string> } {
  return {
    cmd: ["bun", "--smol", "--no-env-file", "musicplayer.ts"],
    env: {
      PATH: parentEnv["PATH"] ?? "",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      APP_URL,
      APP_ENV: "production",
      DATABASE_PATH: databasePath,
      DISCORD_CLIENT_ID: "000000000000000000",
      DISCORD_CLIENT_SECRET: "unused-when-measuring",
      DISCORD_REDIRECT_URI: `${APP_URL}/api/auth/discord/callback`,
      DISCORD_ALLOWED_USER_IDS: LISTENERS.map((_, index) => discordIdOf(index)).join(","),
      YOUTUBE_API_KEY: PLACEHOLDER_YOUTUBE_KEY,
      YOUTUBE_REGION_CODE: "EE",
    },
  };
}

/** The listeners, each with a live session. Returns their session tokens by id. */
export function seedPeople(db: Database, now: number): Record<string, string> {
  const tokens: Record<string, string> = {};
  LISTENERS.forEach((id, index) => {
    db.query(
      "INSERT INTO users (id, discord_id, username, global_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, discordIdOf(index), id, id, now, now);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const hash = new Bun.CryptoHasher("sha256").update(token, "utf8").digest("hex");
    db.query(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(hash, id, now, now + 86_400_000);
    tokens[id] = token;
  });
  return tokens;
}

/**
 * Songs as the catalog caches them, fetched just now: an add finds them in
 * the cache, and the boot's maintenance finds nothing old enough to refresh.
 */
export function seedSongs(db: Database, videoIds: string[], now: number): void {
  const insert = db.query(
    `INSERT INTO tracks (id, provider, provider_track_id, title, artist, duration_ms, artwork_url, fetched_at)
     VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const [index, videoId] of videoIds.entries()) {
      insert.run(
        `youtube:${videoId}`,
        videoId,
        // As long as real titles tend to run, so the welcome weighs what a real one would.
        `Song ${videoId} (Official Music Video) - Some Artist feat. Another Artist`,
        `Some Artist ${index % 97}`,
        180_000 + (index % 120) * 1000,
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        now,
      );
    }
  })();
}

export const FULL_ROOM_IDS = Array.from(
  { length: MAX_ROOM_ENTRIES },
  (_, index) => `full${String(index).padStart(7, "0")}`,
);

/**
 * The room full to its limit, its songs cached and queued by all three
 * listeners in turn, the first one playing — built by the room's own rules
 * and saved as a clean shutdown, so the server boots straight into it.
 */
export async function seedFullRoom(db: Database, now: number): Promise<RoomState> {
  seedSongs(db, FULL_ROOM_IDS, now);
  const entries: QueueEntry[] = FULL_ROOM_IDS.map((videoId, index) => ({
    id: crypto.randomUUID(),
    ownerId: LISTENERS[index % LISTENERS.length] as string,
    trackId: `youtube:${videoId}`,
    durationMs: 180_000 + (index % 120) * 1000,
    addedAt: now - MAX_ROOM_ENTRIES + index,
  }));
  const state = commit(emptyRoom(), [
    { type: "queued", entries },
    { type: "advanced", reason: "started", next: entries[0]?.id ?? null, at: now },
  ]);
  await new SqliteRoomRepository(db).save(state, now, true);
  return state;
}

/**
 * What a listener sends on its `sent`th command: mostly steering, sometimes
 * one seeded song. Never a playlist, and never a song the cache lacks.
 */
export function commandFor(
  sent: number,
  offset: number,
  current: { entryId: string; status: "playing" | "paused" } | null,
): CommandOp {
  const turn = sent + offset;
  const song = SONG_IDS[(sent * LISTENERS.length + offset) % SONG_IDS.length] as string;
  if (current === null || turn % 4 === 0)
    return { type: "add", url: `https://youtu.be/${song}`, scope: "song" };
  if (turn % 4 === 1) {
    return { type: current.status === "playing" ? "pause" : "resume", entryId: current.entryId };
  }
  if (turn % 4 === 2) return { type: "seek", entryId: current.entryId, positionMs: 30_000 };
  return { type: "skip", entryId: current.entryId };
}

/** What one listener's commands came to — so a run where nobody got in cannot pass as a light one. */
export interface Traffic {
  welcomed: boolean;
  accepted: number;
  refused: number;
  /** The welcome as it arrived: how big, and how long after the socket was asked for. */
  welcomeBytes: number;
  welcomeMs: number;
}

/** A listener as a browser would be: pings, presence, one command every ten seconds. */
function listen(token: string, offset: number): { traffic: Traffic; stop: () => void } {
  let room: ClientRoom = emptyClientRoom();
  let sent = 0;
  const traffic: Traffic = {
    welcomed: false,
    accepted: 0,
    refused: 0,
    welcomeBytes: 0,
    welcomeMs: 0,
  };
  const askedAt = performance.now();
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/room/socket`, {
    headers: { Origin: APP_URL, Cookie: `mp_session=${token}` },
  } as unknown as string[]);
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message));

  socket.onmessage = (event) => {
    const raw = String(event.data);
    const message = JSON.parse(raw) as ServerMessage;
    if (message.t === "welcome") {
      traffic.welcomed = true;
      traffic.welcomeBytes = Buffer.byteLength(raw);
      traffic.welcomeMs = performance.now() - askedAt;
    }
    if (message.t === "ack") traffic.accepted += 1;
    if (message.t === "nack") traffic.refused += 1;
    room = receive(room, message);
    if (room.behind) send({ t: "resync" });
  };
  socket.onopen = () => {
    for (let id = 1; id <= 5; id += 1) send({ t: "ping", id, c: performance.now() });
    send({ t: "presence", listening: true, sync: "in_sync", errorCode: null });
  };

  const commands = setInterval(() => {
    sent += 1;
    send({ t: "cmd", id: `c${sent}`, op: commandFor(sent, offset, room.state.current) });
  }, COMMAND_EVERY_MS);
  const pings = setInterval(
    () => send({ t: "ping", id: 100 + sent, c: performance.now() }),
    60_000,
  );

  return {
    traffic,
    stop: () => {
      clearInterval(commands);
      clearInterval(pings);
      socket.close(1000);
    },
  };
}

async function sampleFor(
  pid: number,
  seconds: number,
  clockTicksPerSecond: number,
  startedAt: number,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  let ticks = cpuTicks(await Bun.file(`/proc/${pid}/stat`).text());
  let when = performance.now();
  for (let index = 0; index < seconds; index += 1) {
    await sleep(1000);
    const nowTicks = cpuTicks(await Bun.file(`/proc/${pid}/stat`).text());
    const now = performance.now();
    samples.push({
      at: Math.round((now - startedAt) / 1000),
      rssBytes: rssBytes(await Bun.file(`/proc/${pid}/status`).text()),
      cpuPercent: (100 * (nowTicks - ticks)) / clockTicksPerSecond / ((now - when) / 1000),
    });
    ticks = nowTicks;
    when = now;
  }
  return samples;
}

/** What a full room adds to judge: how long it takes to come up and to hand itself over. */
export interface FullRoomLimits {
  bootMs: number;
  welcomeBytes: number;
  welcomeMs: number;
}

export interface Scenario {
  name: "base" | "full";
  idleSeconds: number;
  busySeconds: number;
  targets: Targets;
  fullRoom: FullRoomLimits | null;
}

/**
 * The worst measured plus about 15 %, under the service's MemoryHigh=160M.
 * Growth here is warm-up, not a leak check: with a full room the resident set
 * climbs for about ten minutes and then holds, which three minutes cannot
 * tell apart. The base scenario, whose room stays small, is the leak check.
 */
export const FULL_ROOM_TARGETS: Targets = {
  idleRssMb: 60,
  busyRssMb: 80,
  idleCpuPercent: 0.5,
  busyCpuPercent: 0.5,
  growthMb: 10,
};
/**
 * A full room's welcome is the whole room, sent to every listener on every
 * reconnect. Boot and welcome times have room for a slower machine; boot
 * stays far inside the deploy's 10 s health window.
 */
export const FULL_ROOM_LIMITS: FullRoomLimits = {
  bootMs: 1000,
  welcomeBytes: 2_900_000,
  welcomeMs: 200,
};

export const SCENARIOS: Record<Scenario["name"], Scenario> = {
  base: { name: "base", idleSeconds: 60, busySeconds: 300, targets: TARGETS, fullRoom: null },
  full: {
    name: "full",
    idleSeconds: 30,
    busySeconds: 180,
    targets: FULL_ROOM_TARGETS,
    fullRoom: FULL_ROOM_LIMITS,
  },
};

const line = (ok: boolean, name: string, value: number, limit: number, digits = 2) =>
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${name.padEnd(16)} ${value.toFixed(digits).padStart(10)}  (at most ${limit})`,
  );

async function measure(scenario: Scenario): Promise<boolean> {
  console.log(`\n=== ${scenario.name} ===`);
  const workdir = await mkdtemp(path.join(tmpdir(), "musicplayer-measure-"));
  const databasePath = path.join(workdir, "measure.db");
  const clockTicksPerSecond = Number(Bun.spawnSync(["getconf", "CLK_TCK"]).stdout.toString());

  // Seeded before boot: the server reads the room once, as it starts.
  const db = openDatabase(databasePath);
  migrate(db);
  const now = Date.now();
  const tokens = seedPeople(db, now);
  seedSongs(db, SONG_IDS, now);
  if (scenario.fullRoom !== null) await seedFullRoom(db, now);
  db.close();

  const { cmd, env } = serverProcess(databasePath, process.env);
  const spawnedAt = performance.now();
  const server = Bun.spawn(cmd, { env, stdout: "ignore", stderr: "inherit" });

  const listeners: ReturnType<typeof listen>[] = [];
  let failed: boolean;
  try {
    await waitForHealth();
    const bootMs = performance.now() - spawnedAt;
    const startedAt = performance.now();

    console.log(`Alone for ${scenario.idleSeconds} s…`);
    const idle = await sampleFor(server.pid, scenario.idleSeconds, clockTicksPerSecond, startedAt);

    console.log(`${LISTENERS.length} listeners for ${scenario.busySeconds} s…`);
    listeners.push(...LISTENERS.map((id, index) => listen(tokens[id] as string, index)));
    const busy = await sampleFor(server.pid, scenario.busySeconds, clockTicksPerSecond, startedAt);

    const traffic = listeners.map((one) => one.traffic);
    const accepted = traffic.reduce((total, one) => total + one.accepted, 0);
    const refused = traffic.reduce((total, one) => total + one.refused, 0);
    const joined = traffic.filter((one) => one.welcomed).length;
    console.log(
      `${joined} of ${LISTENERS.length} listeners joined; ${accepted} commands accepted, ${refused} refused`,
    );
    const loaded = joined === LISTENERS.length && accepted > 0;
    if (!loaded) console.error("FAIL  the listeners never got in, so the server was never loaded");

    console.log(
      `RSS by minute with listeners: ${rssByMinute(busy)
        .map((mb) => mb.toFixed(1))
        .join(" → ")} MB`,
    );
    const results = verdicts(summarize(idle, busy), scenario.targets);
    for (const { name, value, limit, ok } of results) line(ok, name, value, limit);
    failed = !loaded || !results.every((result) => result.ok);

    if (scenario.fullRoom !== null) {
      const measured: FullRoomLimits = {
        bootMs,
        welcomeBytes: Math.max(...traffic.map((one) => one.welcomeBytes)),
        welcomeMs: Math.max(...traffic.map((one) => one.welcomeMs)),
      };
      for (const name of Object.keys(scenario.fullRoom) as (keyof FullRoomLimits)[]) {
        const ok = measured[name] <= scenario.fullRoom[name];
        line(ok, name, measured[name], scenario.fullRoom[name], 0);
        failed ||= !ok;
      }
    }
  } finally {
    for (const one of listeners) one.stop();
    server.kill("SIGTERM");
    const exitCode = await server.exited;
    if (exitCode !== 0) {
      console.error(`FAIL  the server exited with ${exitCode} on SIGTERM`);
      failed = true;
    }
    await rm(workdir, { recursive: true, force: true });
  }
  return !failed;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const up = await fetch(`http://127.0.0.1:${PORT}/api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    await sleep(100);
  }
  throw new Error(`The server did not answer on port ${PORT} within 10 s`);
}

/** The scenarios a command line asks for: one by name, or both. */
export function scenariosFor(argument: string | undefined): Scenario[] {
  if (argument === undefined) return [SCENARIOS.base, SCENARIOS.full];
  if (argument === "base" || argument === "full") return [SCENARIOS[argument]];
  throw new Error(`Unknown scenario "${argument}": use base, full, or nothing for both`);
}

if (import.meta.main) {
  let passed = true;
  for (const scenario of scenariosFor(process.argv[2])) {
    passed = (await measure(scenario)) && passed;
  }
  process.exit(passed ? 0 : 1);
}
