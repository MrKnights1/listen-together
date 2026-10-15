import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { UuidIdGenerator } from "@/shared/infrastructure/UuidIdGenerator.ts";
import { AccessList } from "@/modules/identity/application/AccessList.ts";
import { AddGuest } from "@/modules/identity/application/AddGuest.ts";
import { CompleteDiscordLogin } from "@/modules/identity/application/CompleteDiscordLogin.ts";
import { DeclineAccessRequest } from "@/modules/identity/application/DeclineAccessRequest.ts";
import { GetGuestList } from "@/modules/identity/application/GetGuestList.ts";
import { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import { LogOut } from "@/modules/identity/application/LogOut.ts";
import { RemoveGuest } from "@/modules/identity/application/RemoveGuest.ts";
import { SetGuestAdmin } from "@/modules/identity/application/SetGuestAdmin.ts";
import { StartDiscordLogin } from "@/modules/identity/application/StartDiscordLogin.ts";
import { Hosts } from "@/modules/identity/domain/Hosts.ts";
import type { GuestListView } from "@/modules/identity/http/adminViews.ts";
import { createIdentityRoutes } from "@/modules/identity/http/routes.ts";
import { SqliteAccessRequestRepository } from "@/modules/identity/infrastructure/persistence/SqliteAccessRequestRepository.ts";
import { SqliteGuestRepository } from "@/modules/identity/infrastructure/persistence/SqliteGuestRepository.ts";
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
/** What the browser's Origin header says for a page of this app. */
const ORIGIN = "http://music.test";
const CY_DISCORD_ID = "333333333333333333";

let server: Server<unknown>;
let db: Database;
let oauth: StubDiscordOAuth;

/**
 * The whole module end to end over real HTTP: real routes, real cookies, real
 * SQLite. Only Discord is stubbed — it is the one thing the test cannot reach.
 *
 * The hosts are boot-time configuration, so changing them means starting the
 * server again over the same database — exactly what a deploy does. Guests
 * live in the database and change through the admin API.
 */
function startServer(adminIds: string[]): void {
  const clock = new FakeClock(NOW);
  const users = new SqliteUserRepository(db);
  const sessions = new SqliteSessionRepository(db);
  const guests = new SqliteGuestRepository(db);
  const accessRequests = new SqliteAccessRequestRepository(db);
  const tokens = new WebCryptoTokenGenerator();
  const hosts = Hosts.of(adminIds);
  const accessList = new AccessList(hosts, guests);

  server = Bun.serve({
    port: 0,
    routes: createIdentityRoutes({
      startDiscordLogin: new StartDiscordLogin(oauth, tokens, clock),
      completeDiscordLogin: new CompleteDiscordLogin(
        oauth,
        accessList,
        accessRequests,
        users,
        sessions,
        tokens,
        new UuidIdGenerator(),
        clock,
      ),
      getSessionUser: new GetSessionUser(sessions, users, accessList, tokens, clock),
      logOut: new LogOut(sessions, tokens),
      secureCookies: false,
      accessList,
      appOrigin: ORIGIN,
      getGuestList: new GetGuestList(hosts, guests, accessRequests, users),
      addGuest: new AddGuest(hosts, guests, accessRequests, clock),
      removeGuest: new RemoveGuest(hosts, guests, users, sessions),
      setGuestAdmin: new SetGuestAdmin(hosts, guests),
      declineAccessRequest: new DeclineAccessRequest(accessRequests),
    }),
    fetch: () => new Response("Not found", { status: 404 }),
  });
}

async function call(
  path: string,
  init: { method?: string; cookie?: string; origin?: string; json?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (init.cookie !== undefined) headers["cookie"] = init.cookie;
  if (init.origin !== undefined) headers["origin"] = init.origin;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  return await fetch(new URL(path, server.url), {
    method: init.method ?? "GET",
    redirect: "manual",
    headers,
    body: init.json === undefined ? null : JSON.stringify(init.json),
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

function count(table: "users" | "sessions" | "guests" | "access_requests"): number {
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
    expect(body.user["isAdmin"]).toBe(true);
    expect(Object.keys(body.user).sort()).toEqual(["avatarUrl", "id", "isAdmin", "name"]);
  });

  test("stores a hash of the session token, never the token", async () => {
    const { session } = await signIn();
    const token = decodeURIComponent(session.split("=")[1] ?? "");

    const stored = db.query("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.token_hash).not.toBe(token);
    expect(stored[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("turns a stranger away with a reason, leaving only their request to join", async () => {
    oauth.profile = adaProfile({ id: STRANGER_DISCORD_ID });

    const { session, callback } = await signIn();

    expect(callback.headers.get("location")).toBe("/login?error=not_allowed");
    expect(session).toBe("");
    expect(count("users")).toBe(0);
    expect(count("sessions")).toBe(0);
    expect(count("access_requests")).toBe(1);
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

describe("the admin API over HTTP", () => {
  const BOB = adaProfile({ id: STRANGER_DISCORD_ID, username: "bob", globalName: "Bob" });

  async function signInAs(profile: ReturnType<typeof adaProfile>): Promise<string> {
    oauth.profile = profile;
    return (await signIn()).session;
  }

  async function guestList(cookie: string): Promise<GuestListView> {
    return (await (await call("/api/admin/guests", { cookie })).json()) as GuestListView;
  }

  const add = (cookie: string, json: unknown, origin = ORIGIN) =>
    call("/api/admin/guests", { method: "POST", cookie, origin, json });

  test("refuses anybody who is not signed in", async () => {
    expect((await call("/api/admin/guests")).status).toBe(401);
  });

  test("refuses a guest: only hosts manage guests", async () => {
    const ada = await signInAs(adaProfile());
    await add(ada, { discordId: STRANGER_DISCORD_ID });
    const bob = await signInAs(BOB);

    const who = (await (await call("/api/auth/session", { cookie: bob })).json()) as {
      user: { isAdmin: boolean };
    };
    expect(who.user.isAdmin).toBe(false);
    expect((await call("/api/admin/guests", { cookie: bob })).status).toBe(403);
    expect((await add(bob, { discordId: CY_DISCORD_ID })).status).toBe(403);
  });

  test("refuses a change from another site, and changes nothing", async () => {
    const ada = await signInAs(adaProfile());

    const response = await add(ada, { discordId: CY_DISCORD_ID }, "https://evil.example");

    expect(response.status).toBe(403);
    expect(count("guests")).toBe(0);
  });

  test("a stranger asks by signing in, the host approves, and they get in", async () => {
    await signInAs(BOB);
    const ada = await signInAs(adaProfile());
    expect((await guestList(ada)).requests.map((request) => request.name)).toEqual(["Bob"]);

    const approved = await add(ada, { discordId: STRANGER_DISCORD_ID });

    expect(approved.status).toBe(201);
    const listing = (await approved.json()) as GuestListView;
    expect(listing.requests).toEqual([]);
    expect(listing.guests.map((guest) => guest.name)).toEqual(["Bob"]);

    oauth.profile = BOB;
    const { callback } = await signIn();
    expect(callback.headers.get("location")).toBe("/");
  });

  test("the host adds somebody by id, and is told plainly what cannot be done", async () => {
    const ada = await signInAs(adaProfile());

    expect((await add(ada, { discordId: CY_DISCORD_ID, label: "Cy" })).status).toBe(201);
    expect((await add(ada, { discordId: CY_DISCORD_ID })).status).toBe(409);
    expect((await add(ada, { discordId: ADA_DISCORD_ID })).status).toBe(409);
    expect((await add(ada, { discordId: "bob" })).status).toBe(422);
    expect((await add(ada, { label: "nobody" })).status).toBe(400);

    const notJson = await call("/api/admin/guests", {
      method: "POST",
      cookie: ada,
      origin: ORIGIN,
    });
    expect(notJson.status).toBe(415);
    expect((await guestList(ada)).guests.map((guest) => guest.name)).toEqual(["Cy"]);
  });

  test("removing a guest ends their session at once", async () => {
    const ada = await signInAs(adaProfile());
    await add(ada, { discordId: STRANGER_DISCORD_ID });
    const bob = await signInAs(BOB);

    const removed = await call(`/api/admin/guests/${STRANGER_DISCORD_ID}`, {
      method: "DELETE",
      cookie: ada,
      origin: ORIGIN,
    });

    expect(removed.status).toBe(200);
    expect((await call("/api/auth/session", { cookie: bob })).status).toBe(401);
    const again = await call(`/api/admin/guests/${STRANGER_DISCORD_ID}`, {
      method: "DELETE",
      cookie: ada,
      origin: ORIGIN,
    });
    expect(again.status).toBe(404);
  });

  test("a guest made an admin can manage guests, until it is taken back", async () => {
    const ada = await signInAs(adaProfile());
    await add(ada, { discordId: STRANGER_DISCORD_ID });
    const bob = await signInAs(BOB);
    const setAdmin = (isAdmin: unknown) =>
      call(`/api/admin/guests/${STRANGER_DISCORD_ID}`, {
        method: "PATCH",
        cookie: ada,
        origin: ORIGIN,
        json: { isAdmin },
      });

    const promoted = await setAdmin(true);
    expect(promoted.status).toBe(200);
    expect(((await promoted.json()) as GuestListView).guests[0]?.isAdmin).toBe(true);
    expect((await call("/api/admin/guests", { cookie: bob })).status).toBe(200);
    expect((await add(bob, { discordId: CY_DISCORD_ID })).status).toBe(201);

    expect((await setAdmin(false)).status).toBe(200);
    expect((await call("/api/admin/guests", { cookie: bob })).status).toBe(403);
    expect((await call("/api/auth/session", { cookie: bob })).status).toBe(200);
    expect((await setAdmin("yes")).status).toBe(400);
  });

  test("a host's role cannot be changed from the page", async () => {
    const ada = await signInAs(adaProfile());

    const response = await call(`/api/admin/guests/${ADA_DISCORD_ID}`, {
      method: "PATCH",
      cookie: ada,
      origin: ORIGIN,
      json: { isAdmin: false },
    });

    expect(response.status).toBe(409);
  });

  test("a host cannot be removed from the page", async () => {
    const ada = await signInAs(adaProfile());

    const response = await call(`/api/admin/guests/${ADA_DISCORD_ID}`, {
      method: "DELETE",
      cookie: ada,
      origin: ORIGIN,
    });

    expect(response.status).toBe(409);
  });

  test("declining forgets the request", async () => {
    await signInAs(BOB);
    const ada = await signInAs(adaProfile());
    const decline = () =>
      call(`/api/admin/requests/${STRANGER_DISCORD_ID}`, {
        method: "DELETE",
        cookie: ada,
        origin: ORIGIN,
      });

    expect((await decline()).status).toBe(200);
    expect(count("access_requests")).toBe(0);
    expect((await decline()).status).toBe(404);
  });
});
