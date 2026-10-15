/**
 * Composition root. The only file that knows about configuration, the database,
 * and which adapter satisfies which port — everything else receives its
 * collaborators.
 */
import { readEnv } from "@/env.ts";
import { notFound } from "@/shared/http/httpErrors.ts";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { RecurringJob } from "@/shared/infrastructure/RecurringJob.ts";
import { SystemClock } from "@/shared/infrastructure/SystemClock.ts";
import { SystemTimers } from "@/shared/infrastructure/SystemTimers.ts";
import { UuidIdGenerator } from "@/shared/infrastructure/UuidIdGenerator.ts";

import {
  AllowedDiscordUsers,
  CompleteDiscordLogin,
  createIdentityRoutes,
  DISCORD_ENDPOINTS,
  DiscordOAuthClient,
  GetSessionUser,
  LogOut,
  PurgeExpiredSessions,
  SqliteSessionRepository,
  SqliteUserRepository,
  StartDiscordLogin,
  WebCryptoTokenGenerator,
} from "@/modules/identity/index.ts";

import {
  FindTracks,
  MaintainTrackCache,
  ResolveTrackUrl,
  SqliteTrackRepository,
  YOUTUBE_DATA_API,
  YouTubeDataApiClient,
  YouTubeTrackResolver,
} from "@/modules/catalog/index.ts";

import {
  CatalogTrackSource,
  MaintainQueue,
  MathRandom,
  PauseEmptyRoom,
  RestoreRoom,
  RoomEngine,
  SqliteActivityRepository,
  SqliteRoomRepository,
} from "@/modules/room/index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The most songs one pasted playlist may add. */
const MAX_PLAYLIST_ITEMS = 200;

const env = readEnv();

const db = openDatabase(env.databasePath);
const applied = migrate(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

const clock = new SystemClock();
const timers = new SystemTimers();
const ids = new UuidIdGenerator();
const secureCookies = env.appUrl.startsWith("https://");

// Identity
const tokens = new WebCryptoTokenGenerator();
const users = new SqliteUserRepository(db);
const sessions = new SqliteSessionRepository(db);
const allowed = AllowedDiscordUsers.of(env.discordAllowedUserIds);
const discord = new DiscordOAuthClient({
  clientId: env.discordClientId,
  clientSecret: env.discordClientSecret,
  redirectUri: env.discordRedirectUri,
  endpoints: DISCORD_ENDPOINTS,
});
const getSessionUser = new GetSessionUser(sessions, users, allowed, tokens, clock);

const identityRoutes = createIdentityRoutes({
  startDiscordLogin: new StartDiscordLogin(discord, tokens, clock),
  completeDiscordLogin: new CompleteDiscordLogin(
    discord,
    allowed,
    users,
    sessions,
    tokens,
    ids,
    clock,
  ),
  getSessionUser,
  logOut: new LogOut(sessions, tokens),
  secureCookies,
});

const purgeExpiredSessions = new PurgeExpiredSessions(sessions, clock);
const sessionPurge = new RecurringJob(
  "Purging expired sessions",
  DAY_MS,
  () => purgeExpiredSessions.execute(),
  timers,
);
await sessionPurge.start();

// Catalog
const trackRepository = new SqliteTrackRepository(db);
const youtubeResolver = new YouTubeTrackResolver(
  new YouTubeDataApiClient({ apiKey: env.youtubeApiKey, baseUrl: YOUTUBE_DATA_API }),
  trackRepository,
  clock,
  {
    regionCode: env.youtubeRegionCode,
    maxPlaylistItems: MAX_PLAYLIST_ITEMS,
    cacheTtlMs: 30 * DAY_MS,
  },
);
const trackSource = new CatalogTrackSource({
  resolveTrackUrl: new ResolveTrackUrl([youtubeResolver]),
  findTracks: new FindTracks(trackRepository),
  maintainTrackCache: new MaintainTrackCache([youtubeResolver], trackRepository, clock),
});

// Room
const rooms = new SqliteRoomRepository(db);
const activity = new SqliteActivityRepository(db);
const roomEngine = new RoomEngine({ rooms, activity, clock, timers, random: new MathRandom() });
await new RestoreRoom(rooms, trackSource, roomEngine, clock).execute();

const pauseEmptyRoom = new PauseEmptyRoom(roomEngine, timers);
// Nobody is connected yet: a room resumed after a deploy pauses itself if nobody comes back.
pauseEmptyRoom.listenersChanged(0);

const maintainQueue = new MaintainQueue(roomEngine, trackSource, activity, clock);
const roomMaintenance = new RecurringJob(
  "Maintaining the queue and track cache",
  DAY_MS,
  () => maintainQueue.execute(),
  timers,
);
await roomMaintenance.start();

// Production serves the pages from nginx; only development bundles them in-process.
const pageRoutes = env.development ? (await import("./pages.ts")).pages : {};

const server = Bun.serve({
  hostname: env.host,
  port: env.port,
  development: env.development,
  routes: {
    ...pageRoutes,
    ...identityRoutes,
    // The deploy script's smoke check. Says nothing about the process beyond "up".
    "/api/health": { GET: () => Response.json({ status: "ok" }) },
  },
  fetch: () => notFound("There is nothing here."),
});

console.log(`musicplayer listening on http://${server.hostname}:${server.port}`);

let shuttingDown = false;

/**
 * Stop taking requests first, then stop housekeeping, then save the room as
 * cleanly shut down, then close the database. The room is suspended behind
 * any command already running, so that command is saved too; closed the other
 * way round, it would write to a closed handle.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  await server.stop();
  sessionPurge.stop();
  roomMaintenance.stop();
  pauseEmptyRoom.stop();
  await roomEngine.suspend();
  db.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
