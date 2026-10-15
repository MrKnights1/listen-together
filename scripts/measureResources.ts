/**
 * Runs the server as production does (`bun --smol`, APP_ENV=production) on a
 * throwaway database, and measures it: a minute alone, then five minutes with
 * three listeners who each send a command every ten seconds. Fails if any
 * target is missed.
 *
 *   bun run measure
 *
 * Memory is the resident set (VmRSS); CPU is the process's user + system time
 * against the wall clock, as a percentage of one core. Songs and sessions are
 * seeded, so nothing calls Discord or YouTube.
 */
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClientMessage, CommandOp, ServerMessage } from "@/modules/room/contract/messages.ts";
import { emptyClientRoom, receive, type ClientRoom } from "@/modules/room/ui/clientRoom.ts";

const MB = 1024 * 1024;

export const TARGETS = {
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
  targets: typeof TARGETS,
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
const IDLE_SECONDS = 60;
const BUSY_SECONDS = 300;
const COMMAND_EVERY_MS = 10_000;
const LISTENERS = ["measure-ada", "measure-bob", "measure-cy"];
const SONG_IDS = Array.from(
  { length: 40 },
  (_, index) => `measure${String(index).padStart(4, "0")}`,
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function seed(databasePath: string): Record<string, string> {
  const db = new Database(databasePath);
  const now = Date.now();
  const tokens: Record<string, string> = {};
  LISTENERS.forEach((id, index) => {
    db.query(
      "INSERT INTO users (id, discord_id, username, global_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, `8035111022467891${index}`, id, id, now, now);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const hash = new Bun.CryptoHasher("sha256").update(token, "utf8").digest("hex");
    db.query(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    ).run(hash, id, now, now + 86_400_000);
    tokens[id] = token;
  });
  for (const id of SONG_IDS) {
    db.query(
      "INSERT INTO tracks (id, provider, provider_track_id, title, artist, duration_ms, fetched_at) VALUES (?, 'youtube', ?, ?, 'Nobody', 180000, ?)",
    ).run(`youtube:${id}`, id, `Song ${id}`, now);
  }
  db.close();
  return tokens;
}

/** What one listener's commands came to — so a run where nobody got in cannot pass as a light one. */
export interface Traffic {
  welcomed: boolean;
  accepted: number;
  refused: number;
}

/** A listener as a browser would be: pings, presence, one command every ten seconds. */
function listen(token: string, offset: number): { traffic: Traffic; stop: () => void } {
  let room: ClientRoom = emptyClientRoom();
  let sent = 0;
  const traffic: Traffic = { welcomed: false, accepted: 0, refused: 0 };
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/room/socket`, {
    headers: { Origin: APP_URL, Cookie: `mp_session=${token}` },
  } as unknown as string[]);
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message));

  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.t === "welcome") traffic.welcomed = true;
    if (message.t === "ack") traffic.accepted += 1;
    if (message.t === "nack") traffic.refused += 1;
    room = receive(room, message);
    if (room.behind) send({ t: "resync" });
  };
  socket.onopen = () => {
    for (let id = 1; id <= 5; id += 1) send({ t: "ping", id, c: performance.now() });
    send({ t: "presence", listening: true, sync: "in_sync", errorCode: null });
  };

  const nextCommand = (): CommandOp => {
    const turn = sent + offset;
    const current = room.state.current;
    const song = SONG_IDS[(sent * LISTENERS.length + offset) % SONG_IDS.length] as string;
    if (current === null || turn % 4 === 0) return { type: "add", url: `https://youtu.be/${song}` };
    if (turn % 4 === 1) {
      return { type: current.status === "playing" ? "pause" : "resume", entryId: current.entryId };
    }
    if (turn % 4 === 2) return { type: "seek", entryId: current.entryId, positionMs: 30_000 };
    return { type: "skip", entryId: current.entryId };
  };

  const commands = setInterval(() => {
    sent += 1;
    send({ t: "cmd", id: `c${sent}`, op: nextCommand() });
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

async function main(): Promise<number> {
  const workdir = await mkdtemp(path.join(tmpdir(), "musicplayer-measure-"));
  const databasePath = path.join(workdir, "measure.db");
  const clockTicksPerSecond = Number(Bun.spawnSync(["getconf", "CLK_TCK"]).stdout.toString());

  const server = Bun.spawn(["bun", "--smol", "--no-env-file", "musicplayer.ts"], {
    env: {
      PATH: process.env["PATH"] ?? "",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      APP_URL,
      APP_ENV: "production",
      DATABASE_PATH: databasePath,
      DISCORD_CLIENT_ID: "000000000000000000",
      DISCORD_CLIENT_SECRET: "unused-when-measuring",
      DISCORD_REDIRECT_URI: `${APP_URL}/api/auth/discord/callback`,
      DISCORD_ALLOWED_USER_IDS: LISTENERS.map((_, index) => `8035111022467891${index}`).join(","),
      YOUTUBE_API_KEY: "unused-when-measuring",
      YOUTUBE_REGION_CODE: "EE",
    },
    stdout: "ignore",
    stderr: "inherit",
  });

  const listeners: ReturnType<typeof listen>[] = [];
  let failed: boolean;
  try {
    await waitForHealth();
    const tokens = seed(databasePath);
    const startedAt = performance.now();

    console.log(`Alone for ${IDLE_SECONDS} s…`);
    const idle = await sampleFor(server.pid, IDLE_SECONDS, clockTicksPerSecond, startedAt);

    console.log(`${LISTENERS.length} listeners for ${BUSY_SECONDS} s…`);
    listeners.push(...LISTENERS.map((id, index) => listen(tokens[id] as string, index)));
    const busy = await sampleFor(server.pid, BUSY_SECONDS, clockTicksPerSecond, startedAt);

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
    const results = verdicts(summarize(idle, busy), TARGETS);
    for (const { name, value, limit, ok } of results) {
      console.log(
        `${ok ? "ok  " : "FAIL"}  ${name.padEnd(16)} ${value.toFixed(2).padStart(8)}  (at most ${limit})`,
      );
    }
    failed = !loaded || !results.every((result) => result.ok);
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
  return failed ? 1 : 0;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const up = await fetch(`http://127.0.0.1:${PORT}/api/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    await sleep(100);
  }
  throw new Error(`The server did not answer on port ${PORT} within 5 s`);
}

if (import.meta.main) process.exit(await main());
