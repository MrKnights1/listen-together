import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { UuidIdGenerator } from "@/shared/infrastructure/UuidIdGenerator.ts";
import { CompleteDiscordLogin } from "@/modules/identity/application/CompleteDiscordLogin.ts";
import { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import { LogOut } from "@/modules/identity/application/LogOut.ts";
import { StartDiscordLogin } from "@/modules/identity/application/StartDiscordLogin.ts";
import { AllowedDiscordUsers } from "@/modules/identity/domain/AllowedDiscordUsers.ts";
import { createIdentityRoutes } from "@/modules/identity/http/routes.ts";
import { SqliteSessionRepository } from "@/modules/identity/infrastructure/persistence/SqliteSessionRepository.ts";
import { SqliteUserRepository } from "@/modules/identity/infrastructure/persistence/SqliteUserRepository.ts";
import { WebCryptoTokenGenerator } from "@/modules/identity/infrastructure/WebCryptoTokenGenerator.ts";
import {
  ADA_DISCORD_ID,
  adaProfile,
  FakeClock,
  STRANGER_DISCORD_ID,
  StubDiscordOAuth,
} from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");

let server: Server<unknown>;
let db: Database;
let oauth: StubDiscordOAuth;

/**
 * The whole module end to end over real HTTP: real routes, real cookies, real
 * SQLite. Only Discord is stubbed — it is the one thing the test cannot reach.
 *
 * The whitelist is boot-time configuration, so changing it means starting the
 * server again over the same database — exactly what a deploy does.
 */
function startServer(allowedIds: string[]): void {
  const clock = new FakeClock(NOW);
  const users = new SqliteUserRepository(db);
  const sessions = new SqliteSessionRepository(db);
  const tokens = new WebCryptoTokenGenerator();
  const allowed = AllowedDiscordUsers.of(allowedIds);

  server = Bun.serve({
    port: 0,
    routes: createIdentityRoutes({
      startDiscordLogin: new StartDiscordLogin(oauth, tokens, clock),
      completeDiscordLogin: new CompleteDiscordLogin(
        oauth,
        allowed,
        users,
        sessions,
        tokens,
        new UuidIdGenerator(),
        clock,
      ),
      getSessionUser: new GetSessionUser(sessions, users, allowed, tokens, clock),
      logOut: new LogOut(sessions, tokens),
      secureCookies: false,
    }),
    fetch: () => new Response("Not found", { status: 404 }),
  });
}

async function call(path: string, init: { method?: string; cookie?: string } = {}) {
  return await fetch(new URL(path, server.url), {
    method: init.method ?? "GET",
    redirect: "manual",
    headers: init.cookie === undefined ? {} : { cookie: init.cookie },
  });
}

function cookiePair(response: Response, name: string): string | null {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return header === undefined ? null : (header.split(";")[0] ?? null);
}

function cookieHeader(response: Response, name: string): string | undefined {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
}

function isCleared(response: Response, name: string): boolean {
  return cookieHeader(response, name)?.includes("Max-Age=0") ?? false;
}

function count(table: "users" | "sessions"): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Walks a browser through start → Discord → callback. */
async function signIn(): Promise<{ session: string; callback: Response }> {
  const started = await call("/api/auth/discord/start");
  const loginCookie = cookiePair(started, "mp_login") ?? "";
  const state = new URL(started.headers.get("location") ?? "").searchParams.get("state") ?? "";

  const callback = await call(
    `/api/auth/discord/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    { cookie: loginCookie },
  );

  return { session: cookiePair(callback, "mp_session") ?? "", callback };
}

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
  oauth = new StubDiscordOAuth();
  startServer([ADA_DISCORD_ID]);
});
afterEach(() => void server.stop(true));

describe("Discord sign-in over HTTP", () => {
  test("refuses to say who is signed in before anyone is", async () => {
    const response = await call("/api/auth/session");

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("sends the browser to Discord and remembers the sign-in in a scoped cookie", async () => {
    const response = await call("/api/auth/discord/start");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toStartWith(
      "https://discord.example/oauth2/authorize",
    );
    const login = cookieHeader(response, "mp_login") ?? "";
    expect(login).toContain("Path=/api/auth");
    expect(login).toContain("HttpOnly");
    expect(login).toContain("SameSite=Lax");
  });

  test("signs a whitelisted friend in and lands them in the room", async () => {
    const { session, callback } = await signIn();

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    expect(isCleared(callback, "mp_login")).toBe(true);
    expect(cookieHeader(callback, "mp_session")).toContain("HttpOnly");

    const who = await call("/api/auth/session", { cookie: session });
    expect(who.status).toBe(200);
    const body = (await who.json()) as { user: Record<string, unknown> };
    expect(body.user["name"]).toBe("Ada Lovelace");
    expect(Object.keys(body.user).sort()).toEqual(["avatarUrl", "id", "name"]);
  });

  test("stores a hash of the session token, never the token", async () => {
    const { session } = await signIn();
    const token = decodeURIComponent(session.split("=")[1] ?? "");

    const stored = db.query("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).not.toBe(token);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("turns a stranger away with a reason and writes nothing", async () => {
    oauth.profile = adaProfile({ id: STRANGER_DISCORD_ID });

    const { session, callback } = await signIn();

    expect(callback.headers.get("location")).toBe("/login?error=not_allowed");
    expect(session).toBe("");
    expect(count("users")).toBe(0);
    expect(count("sessions")).toBe(0);
  });

  test("ends a friend's access on their next request once they are taken off the list", async () => {
    const { session } = await signIn();
    await server.stop(true);
    startServer([]);

    const response = await call("/api/auth/session", { cookie: session });

    expect(response.status).toBe(403);
    expect(count("sessions")).toBe(0);
  });

  test("signing out deletes the session and clears the cookie", async () => {
    const { session } = await signIn();

    const out = await call("/api/auth/session", { method: "DELETE", cookie: session });

    expect(out.status).toBe(204);
    expect(isCleared(out, "mp_session")).toBe(true);
    expect((await call("/api/auth/session", { cookie: session })).status).toBe(401);
  });

  test("a callback whose state does not match is refused before Discord is asked", async () => {
    const started = await call("/api/auth/discord/start");

    const callback = await call("/api/auth/discord/callback?code=c&state=forged", {
      cookie: cookiePair(started, "mp_login") ?? "",
    });

    expect(callback.headers.get("location")).toBe("/login?error=state_mismatch");
    expect(isCleared(callback, "mp_login")).toBe(true);
    expect(oauth.exchanges).toEqual([]);
  });

  test("a callback without its sign-in cookie is sent back as expired", async () => {
    const callback = await call("/api/auth/discord/callback?code=c&state=s");

    expect(callback.headers.get("location")).toBe("/login?error=expired");
  });

  test("a callback missing the code is incomplete", async () => {
    expect((await call("/api/auth/discord/callback?state=s")).headers.get("location")).toBe(
      "/login?error=incomplete",
    );
  });

  test("pressing Cancel on Discord comes back as declined", async () => {
    const callback = await call("/api/auth/discord/callback?error=access_denied&state=s");

    expect(callback.headers.get("location")).toBe("/login?error=declined");
  });

  test("Discord failing comes back as unavailable, without a stack trace in the response", async () => {
    oauth.failure = new Error("Discord rejected the authorization code (HTTP 500).");
    const original = console.error;
    console.error = () => {};

    try {
      const { callback } = await signIn();

      expect(callback.headers.get("location")).toBe("/login?error=unavailable");
      expect(await callback.text()).toBe("");
    } finally {
      console.error = original;
    }
  });
});
