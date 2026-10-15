/**
 * Composition root. The only file that knows about configuration, the database,
 * and which adapter satisfies which port — everything else receives its
 * collaborators.
 */
import { readEnv } from "@/env.ts";
import { notFound } from "@/shared/http/httpErrors.ts";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";

const env = readEnv();

const db = openDatabase(env.databasePath);
const applied = migrate(db);
if (applied.length > 0) console.log(`Applied migrations: ${applied.join(", ")}`);

const server = Bun.serve({
  hostname: env.host,
  port: env.port,
  development: env.development,
  routes: {
    // The deploy script's smoke check. Says nothing about the process beyond "up".
    "/api/health": { GET: () => Response.json({ status: "ok" }) },
  },
  fetch: () => notFound("There is nothing here."),
});

console.log(`musicplayer listening on http://${server.hostname}:${server.port}`);

let shuttingDown = false;

/**
 * Stop taking requests first, then close the database. Closed the other way
 * round, a request arriving during shutdown would query a closed handle.
 */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  await server.stop();
  db.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
