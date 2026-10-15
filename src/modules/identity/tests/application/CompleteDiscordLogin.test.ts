import { beforeEach, describe, expect, test } from "bun:test";
import { CompleteDiscordLogin } from "@/modules/identity/application/CompleteDiscordLogin.ts";
import { AllowedDiscordUsers } from "@/modules/identity/domain/AllowedDiscordUsers.ts";
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
let tokens: SequenceTokenGenerator;
let clock: FakeClock;
let completeLogin: CompleteDiscordLogin;
let loginRequest: LoginRequest;

beforeEach(() => {
  oauth = new StubDiscordOAuth();
  users = new InMemoryUserRepository();
  sessions = new InMemorySessionRepository();
  tokens = new SequenceTokenGenerator("session");
  clock = new FakeClock(NOW);
  completeLogin = new CompleteDiscordLogin(
    oauth,
    AllowedDiscordUsers.of([ADA_DISCORD_ID]),
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

  /** The rule this module exists for: a stranger leaves nothing behind. */
  test("turns away someone off the whitelist and writes nothing", async () => {
    oauth.profile = adaProfile({ id: STRANGER_DISCORD_ID });

    await expect(completeLogin.execute(loginRequest, "state-1", "code-1")).rejects.toThrow(
      NotAllowed,
    );

    expect(users.count()).toBe(0);
    expect(sessions.count()).toBe(0);
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
