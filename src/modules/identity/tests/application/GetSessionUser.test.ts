import { beforeEach, describe, expect, test } from "bun:test";
import { AccessList } from "@/modules/identity/application/AccessList.ts";
import { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import { Hosts } from "@/modules/identity/domain/Hosts.ts";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { Session, SESSION_LIFETIME_MS } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import {
  ADA_DISCORD_ID,
  adaProfile,
  FakeClock,
  InMemoryGuestRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  SequenceTokenGenerator,
} from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");

let users: InMemoryUserRepository;
let sessions: InMemorySessionRepository;
let guests: InMemoryGuestRepository;
let clock: FakeClock;

function lookup(adminIds: string[]): GetSessionUser {
  return new GetSessionUser(
    sessions,
    users,
    new AccessList(Hosts.of(adminIds), guests),
    new SequenceTokenGenerator(),
    clock,
  );
}

beforeEach(async () => {
  users = new InMemoryUserRepository();
  sessions = new InMemorySessionRepository();
  guests = new InMemoryGuestRepository();
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

  test("says when the session expires, so a long-lived socket knows when to let go", async () => {
    const result = await lookup([ADA_DISCORD_ID]).execute("token-1");

    expect(result.status === "signed_in" ? result.expiresAt.getTime() : null).toBe(
      NOW.getTime() + SESSION_LIFETIME_MS,
    );
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
  test("says not allowed for someone on neither list, and deletes their session", async () => {
    expect(await lookup([]).execute("token-1")).toEqual({ status: "not_allowed" });
    expect(await sessions.findByTokenHash("hash(token-1)")).toBeNull();
  });

  test("lets in a guest a host added, though they are no host", async () => {
    await guests.add({
      discordId: ADA_DISCORD_ID,
      label: null,
      avatarHash: null,
      isAdmin: false,
      addedBy: "123456789012345678",
      addedAt: NOW,
    });

    expect((await lookup([]).execute("token-1")).status).toBe("signed_in");
  });

  test("turns a guest away on their next request once they are removed", async () => {
    await guests.add({
      discordId: ADA_DISCORD_ID,
      label: null,
      avatarHash: null,
      isAdmin: false,
      addedBy: "123456789012345678",
      addedAt: NOW,
    });
    await guests.remove(ADA_DISCORD_ID);

    expect(await lookup([]).execute("token-1")).toEqual({ status: "not_allowed" });
  });
});
