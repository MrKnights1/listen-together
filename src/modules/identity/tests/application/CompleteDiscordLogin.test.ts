import { beforeEach, describe, expect, test } from "bun:test";
import { AccessList } from "@/modules/identity/application/AccessList.ts";
import { CompleteDiscordLogin } from "@/modules/identity/application/CompleteDiscordLogin.ts";
import { Hosts } from "@/modules/identity/domain/Hosts.ts";
import {
  InvalidIdentity,
  LoginRequestExpired,
  NotAllowed,
  StateMismatch,
} from "@/modules/identity/domain/errors.ts";
import { LOGIN_REQUEST_TTL_MS, LoginRequest } from "@/modules/identity/domain/LoginRequest.ts";
import {
  ADA_DISCORD_ID,
  adaProfile,
  FakeClock,
  InMemoryAccessRequestRepository,
  InMemoryGuestRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  SequenceIdGenerator,
  SequenceTokenGenerator,
  STRANGER_DISCORD_ID,
  StubDiscordOAuth,
} from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");

let oauth: StubDiscordOAuth;
let users: InMemoryUserRepository;
let sessions: InMemorySessionRepository;
let guests: InMemoryGuestRepository;
let accessRequests: InMemoryAccessRequestRepository;
let tokens: SequenceTokenGenerator;
let clock: FakeClock;
let completeLogin: CompleteDiscordLogin;
let loginRequest: LoginRequest;

beforeEach(() => {
  oauth = new StubDiscordOAuth();
  users = new InMemoryUserRepository();
  sessions = new InMemorySessionRepository();
  guests = new InMemoryGuestRepository();
  accessRequests = new InMemoryAccessRequestRepository();
  tokens = new SequenceTokenGenerator("session");
  clock = new FakeClock(NOW);
  completeLogin = new CompleteDiscordLogin(
    oauth,
    new AccessList(Hosts.of([ADA_DISCORD_ID]), guests),
    accessRequests,
    users,
    sessions,
    tokens,
    new SequenceIdGenerator(),
    clock,
  );
  loginRequest = LoginRequest.start("state-1", "verifier-1", NOW);
});

describe("CompleteDiscordLogin", () => {
  test("registers a whitelisted first-timer and opens a session for them", async () => {
    const result = await completeLogin.execute(loginRequest, "state-1", "code-1");

    expect(result.user.discordId).toBe(ADA_DISCORD_ID);
    expect(result.sessionToken).toBe("session-1");
    expect(result.session.tokenHash).toBe("hash(session-1)");
    expect(await sessions.findByTokenHash("hash(session-1)")).not.toBeNull();
  });

  test("redeems the code with the verifier this browser was given", async () => {
    await completeLogin.execute(loginRequest, "state-1", "code-1");

    expect(oauth.exchanges).toEqual([{ code: "code-1", codeVerifier: "verifier-1" }]);
  });

  /** A stranger gets no user and no session: only a request a host can answer. */
  test("turns away someone off the guest list, leaving only a request to join", async () => {
    oauth.profile = adaProfile({
      id: STRANGER_DISCORD_ID,
      username: "bob",
      globalName: "Bob",
      avatarHash: "b0b",
    });

    await expect(completeLogin.execute(loginRequest, "state-1", "code-1")).rejects.toThrow(
      NotAllowed,
    );

    expect(users.count()).toBe(0);
    expect(sessions.count()).toBe(0);
    expect(await accessRequests.list()).toEqual([
      {
        discordId: STRANGER_DISCORD_ID,
        username: "bob",
        globalName: "Bob",
        avatarHash: "b0b",
        requestedAt: NOW,
      },
    ]);
  });

  test("asking again refreshes the one request rather than adding another", async () => {
    oauth.profile = adaProfile({ id: STRANGER_DISCORD_ID, username: "bob" });
    await expect(completeLogin.execute(loginRequest, "state-1", "code-1")).rejects.toThrow();
    clock.advance(60_000);
    oauth.profile = adaProfile({ id: STRANGER_DISCORD_ID, username: "bobby" });

    await expect(
      completeLogin.execute(
        LoginRequest.start("state-2", "verifier-2", clock.now()),
        "state-2",
        "code-2",
      ),
    ).rejects.toThrow(NotAllowed);

    const waiting = await accessRequests.list();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.username).toBe("bobby");
    expect(waiting[0]?.requestedAt).toEqual(clock.now());
  });

  test("lets a guest a host added sign in, and asks nothing of them", async () => {
    oauth.profile = adaProfile({ id: STRANGER_DISCORD_ID, username: "bob" });
    await guests.add({
      discordId: STRANGER_DISCORD_ID,
      label: "Bob",
      avatarHash: null,
      isAdmin: false,
      addedBy: ADA_DISCORD_ID,
      addedAt: NOW,
    });

    const result = await completeLogin.execute(loginRequest, "state-1", "code-1");

    expect(result.user.discordId).toBe(STRANGER_DISCORD_ID);
    expect(await accessRequests.list()).toEqual([]);
  });

  test("never spends the code when the state does not match", async () => {
    await expect(completeLogin.execute(loginRequest, "forged", "code-1")).rejects.toThrow(
      StateMismatch,
    );

    expect(oauth.exchanges).toEqual([]);
  });

  test("never spends the code when the sign-in has expired", async () => {
    clock.advance(LOGIN_REQUEST_TTL_MS);

    await expect(completeLogin.execute(loginRequest, "state-1", "code-1")).rejects.toThrow(
      LoginRequestExpired,
    );
    expect(oauth.exchanges).toEqual([]);
  });

  test("refuses a profile Discord sent without a usable id", async () => {
    oauth.profile = adaProfile({ id: "not-a-snowflake" });

    await expect(completeLogin.execute(loginRequest, "state-1", "code-1")).rejects.toThrow(
      InvalidIdentity,
    );
    expect(users.count()).toBe(0);
  });

  test("signs a returning user in as the same person, with Discord's latest name", async () => {
    const first = await completeLogin.execute(loginRequest, "state-1", "code-1");
    oauth.profile = adaProfile({ globalName: "Countess" });

    const second = await completeLogin.execute(
      LoginRequest.start("state-2", "verifier-2", NOW),
      "state-2",
      "code-2",
    );

    expect(second.user.id).toBe(first.user.id);
    expect(second.user.displayName).toBe("Countess");
    expect(users.count()).toBe(1);
  });

  test("hands out a fresh session token on every sign-in", async () => {
    const first = await completeLogin.execute(loginRequest, "state-1", "code-1");
    const second = await completeLogin.execute(
      LoginRequest.start("state-2", "verifier-2", NOW),
      "state-2",
      "code-2",
    );

    expect(second.sessionToken).not.toBe(first.sessionToken);
  });

  test("passes a Discord failure through untouched", async () => {
    oauth.failure = new Error("Discord rejected the authorization code (HTTP 400).");

    await expect(completeLogin.execute(loginRequest, "state-1", "code-1")).rejects.toThrow(
      "HTTP 400",
    );
  });
});
