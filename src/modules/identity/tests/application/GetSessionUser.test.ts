import { beforeEach, describe, expect, test } from "bun:test";
import { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import { AllowedDiscordUsers } from "@/modules/identity/domain/AllowedDiscordUsers.ts";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { Session, SESSION_LIFETIME_MS } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import {
  ADA_DISCORD_ID,
  adaProfile,
  FakeClock,
  InMemorySessionRepository,
  InMemoryUserRepository,
  SequenceTokenGenerator,
} from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");

let users: InMemoryUserRepository;
let sessions: InMemorySessionRepository;
let clock: FakeClock;

function lookup(allowedIds: string[]): GetSessionUser {
  return new GetSessionUser(
    sessions,
    users,
    AllowedDiscordUsers.of(allowedIds),
    new SequenceTokenGenerator(),
    clock,
  );
}

beforeEach(async () => {
  users = new InMemoryUserRepository();
  sessions = new InMemorySessionRepository();
  clock = new FakeClock(NOW);
  await users.save(User.register("user-1", DiscordIdentity.fromProfile(adaProfile()), NOW));
  await sessions.save(Session.open("hash(token-1)", "user-1", NOW));
});

describe("GetSessionUser", () => {
  test("names the user behind a live session", async () => {
    const result = await lookup([ADA_DISCORD_ID]).execute("token-1");

    expect(result.status).toBe("signed_in");
    expect(result.status === "signed_in" ? result.user.id : null).toBe("user-1");
  });

  test("says signed out with no token, a blank one, or an unknown one", async () => {
    const getSessionUser = lookup([ADA_DISCORD_ID]);

    expect(await getSessionUser.execute(null)).toEqual({ status: "signed_out" });
    expect(await getSessionUser.execute("")).toEqual({ status: "signed_out" });
    expect(await getSessionUser.execute("token-9")).toEqual({ status: "signed_out" });
  });

  test("says signed out once the session has expired, and forgets it", async () => {
    clock.advance(SESSION_LIFETIME_MS);

    expect(await lookup([ADA_DISCORD_ID]).execute("token-1")).toEqual({ status: "signed_out" });
    expect(await sessions.findByTokenHash("hash(token-1)")).toBeNull();
  });

  /** Taking someone off the list must not wait 30 days for their session to run out. */
  test("says not allowed for someone taken off the whitelist, and deletes their session", async () => {
    expect(await lookup([]).execute("token-1")).toEqual({ status: "not_allowed" });
    expect(await sessions.findByTokenHash("hash(token-1)")).toBeNull();
  });
});
