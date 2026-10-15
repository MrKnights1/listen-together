import { beforeEach, describe, expect, test } from "bun:test";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { Session } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";
import { ADA_DISCORD_ID, adaProfile, STRANGER_DISCORD_ID } from "./fakes.ts";

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
}

const NOW = new Date("2026-10-15T10:00:00.000Z");

function identity(overrides: Parameters<typeof adaProfile>[0] = {}) {
  return DiscordIdentity.fromProfile(adaProfile(overrides));
}

/**
 * One suite, run against both the SQLite adapters and the in-memory fakes.
 * This is what keeps the fakes honest: if they drift from the real
 * repositories, every unit test built on them tests something that does not
 * exist, and this suite is what catches it.
 */
export function runRepositoryContract(name: string, create: () => Repositories): void {
  describe(`${name} — UserRepository`, () => {
    let users: UserRepository;
    beforeEach(() => {
      users = create().users;
    });

    test("returns nothing for an id that was never saved", async () => {
      expect(await users.findById("nobody")).toBeNull();
    });

    test("returns nothing for a Discord account that never signed in", async () => {
      expect(await users.findByDiscordId(STRANGER_DISCORD_ID)).toBeNull();
    });

    test("round-trips a saved user without changing any field", async () => {
      const user = User.register("user-1", identity({ avatarHash: "a1b2c3" }), NOW);

      await users.save(user);

      expect((await users.findById("user-1"))?.toSnapshot()).toEqual(user.toSnapshot());
    });

    test("keeps a missing display name and avatar null rather than turning them into strings", async () => {
      await users.save(User.register("user-1", identity({ globalName: null }), NOW));

      const stored = await users.findById("user-1");
      expect(stored?.globalName).toBeNull();
      expect(stored?.avatarHash).toBeNull();
    });

    test("finds a saved user by their Discord id", async () => {
      await users.save(User.register("user-1", identity(), NOW));

      expect((await users.findByDiscordId(ADA_DISCORD_ID))?.id).toBe("user-1");
    });

    test("finds several users in one read and leaves out ids that match nothing", async () => {
      await users.save(User.register("user-1", identity(), NOW));
      await users.save(
        User.register("user-2", identity({ id: STRANGER_DISCORD_ID, username: "bob" }), NOW),
      );

      const found = await users.findByIds(["user-2", "ghost", "user-1"]);

      expect(found.map((user) => user.id).sort()).toEqual(["user-1", "user-2"]);
    });

    test("finds nobody when asked about nobody", async () => {
      expect(await users.findByIds([])).toEqual([]);
    });

    test("updates a returning user's profile instead of adding another row", async () => {
      const first = User.register("user-1", identity(), NOW);
      await users.save(first);
      const later = new Date(NOW.getTime() + 86_400_000);

      await users.save(
        first.signedInAgain(identity({ globalName: "Countess", avatarHash: "f00" }), later),
      );

      const stored = await users.findByDiscordId(ADA_DISCORD_ID);
      expect(stored?.globalName).toBe("Countess");
      expect(stored?.avatarHash).toBe("f00");
      expect(stored?.createdAt).toEqual(NOW);
      expect(stored?.lastLoginAt).toEqual(later);
    });

    /**
     * Two first sign-ins racing both find nothing and both register, each with
     * its own id. The second write must land on the first one's row rather
     * than violating `users.discord_id UNIQUE` and failing the sign-in.
     */
    test("collapses a concurrent first sign-in onto one user", async () => {
      const first = await users.save(User.register("user-1", identity(), NOW));

      const second = await users.save(
        User.register("user-2", identity(), new Date(NOW.getTime() + 1000)),
      );

      expect(second.id).toBe(first.id);
      expect(second.createdAt).toEqual(NOW);
      expect(await users.findById("user-2")).toBeNull();
    });
  });

  describe(`${name} — SessionRepository`, () => {
    let sessions: SessionRepository;

    beforeEach(async () => {
      const repositories = create();
      sessions = repositories.sessions;
      await repositories.users.save(User.register("user-1", identity(), NOW));
    });

    test("returns nothing for a token hash that was never saved", async () => {
      expect(await sessions.findByTokenHash("unknown-hash")).toBeNull();
    });

    test("round-trips a saved session without changing any field", async () => {
      const session = Session.open("hash-1", "user-1", NOW);

      await sessions.save(session);

      expect((await sessions.findByTokenHash("hash-1"))?.toSnapshot()).toEqual(
        session.toSnapshot(),
      );
    });

    test("forgets a deleted session", async () => {
      await sessions.save(Session.open("hash-1", "user-1", NOW));

      await sessions.delete("hash-1");

      expect(await sessions.findByTokenHash("hash-1")).toBeNull();
    });

    test("deleting a session that is not there is not an error", async () => {
      await sessions.delete("never-existed");

      expect(await sessions.findByTokenHash("never-existed")).toBeNull();
    });

    test("purges only the sessions that have actually expired", async () => {
      await sessions.save(
        Session.open("hash-old", "user-1", new Date(NOW.getTime() - 40 * 86_400_000)),
      );
      await sessions.save(Session.open("hash-fresh", "user-1", NOW));

      expect(await sessions.deleteExpired(NOW)).toBe(1);
      expect(await sessions.findByTokenHash("hash-old")).toBeNull();
      expect(await sessions.findByTokenHash("hash-fresh")).not.toBeNull();
    });
  });
}
