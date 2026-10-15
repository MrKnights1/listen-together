import { beforeEach, describe, expect, test } from "bun:test";
import { FindUsers } from "@/modules/identity/application/FindUsers.ts";
import { LogOut } from "@/modules/identity/application/LogOut.ts";
import { PurgeExpiredSessions } from "@/modules/identity/application/PurgeExpiredSessions.ts";
import { StartDiscordLogin } from "@/modules/identity/application/StartDiscordLogin.ts";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { LOGIN_REQUEST_TTL_MS } from "@/modules/identity/domain/LoginRequest.ts";
import { Session, SESSION_LIFETIME_MS } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import {
  adaProfile,
  FakeClock,
  InMemorySessionRepository,
  InMemoryUserRepository,
  SequenceTokenGenerator,
  StubDiscordOAuth,
} from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");

let sessions: InMemorySessionRepository;
let clock: FakeClock;

beforeEach(() => {
  sessions = new InMemorySessionRepository();
  clock = new FakeClock(NOW);
});

describe("StartDiscordLogin", () => {
  test("mints a separate state and verifier and sends them to Discord", async () => {
    const tokens = new SequenceTokenGenerator("t");
    const started = await new StartDiscordLogin(new StubDiscordOAuth(), tokens, clock).execute();

    expect(started.loginRequest.state).toBe("t-1");
    expect(started.loginRequest.codeVerifier).toBe("t-2");
    expect(started.authorizationUrl).toContain("state=t-1");
    expect(started.loginRequest.expiresAt.getTime()).toBe(NOW.getTime() + LOGIN_REQUEST_TTL_MS);
  });
});

describe("LogOut", () => {
  test("deletes the session behind the token", async () => {
    await sessions.save(Session.open("hash(token-1)", "user-1", NOW));

    await new LogOut(sessions, new SequenceTokenGenerator()).execute("token-1");

    expect(await sessions.findByTokenHash("hash(token-1)")).toBeNull();
  });

  test("tells whoever asked that the session ended, with its token", async () => {
    await sessions.save(Session.open("hash(token-1)", "user-1", NOW));
    const logOut = new LogOut(sessions, new SequenceTokenGenerator());
    const ended: string[] = [];
    logOut.onSessionEnded((token) => ended.push(token));

    await logOut.execute("token-1");

    expect(ended).toEqual(["token-1"]);
  });

  test("still signs out when a listener fails", async () => {
    await sessions.save(Session.open("hash(token-1)", "user-1", NOW));
    const logOut = new LogOut(sessions, new SequenceTokenGenerator());
    logOut.onSessionEnded(() => {
      throw new Error("listener broke");
    });
    const original = console.error;
    console.error = () => undefined;

    try {
      await logOut.execute("token-1");
    } finally {
      console.error = original;
    }

    expect(await sessions.findByTokenHash("hash(token-1)")).toBeNull();
  });

  test("tells nobody when there was nothing to end", async () => {
    const logOut = new LogOut(sessions, new SequenceTokenGenerator());
    const ended: string[] = [];
    logOut.onSessionEnded((token) => ended.push(token));

    await logOut.execute(null);

    expect(ended).toEqual([]);
  });

  test("does nothing, without complaint, when there is no token", async () => {
    await new LogOut(sessions, new SequenceTokenGenerator()).execute(null);

    expect(sessions.count()).toBe(0);
  });
});

describe("PurgeExpiredSessions", () => {
  test("removes expired sessions and reports how many", async () => {
    await sessions.save(Session.open("hash-old", "user-1", NOW));
    await sessions.save(Session.open("hash-new", "user-1", new Date(NOW.getTime() + 1000)));
    clock.advance(SESSION_LIFETIME_MS);

    expect(await new PurgeExpiredSessions(sessions, clock).execute()).toBe(1);
    expect(await sessions.findByTokenHash("hash-new")).not.toBeNull();
  });
});

describe("FindUsers", () => {
  test("asks once for each distinct id", async () => {
    const users = new InMemoryUserRepository();
    await users.save(User.register("user-1", DiscordIdentity.fromProfile(adaProfile()), NOW));

    const found = await new FindUsers(users).execute(["user-1", "user-1", "ghost"]);

    expect(found.map((user) => user.id)).toEqual(["user-1"]);
  });
});
