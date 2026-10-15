import { beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_ACCESS_REQUESTS,
  type AccessRequest,
} from "@/modules/identity/domain/AccessRequest.ts";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import type { Guest } from "@/modules/identity/domain/Guest.ts";
import { Session } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";
import { ADA_DISCORD_ID, adaProfile, STRANGER_DISCORD_ID } from "./fakes.ts";

export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  guests: GuestRepository;
  accessRequests: AccessRequestRepository;
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

    test("ends every session of one user and nobody else's", async () => {
      const repositories = create();
      await repositories.users.save(User.register("user-1", identity(), NOW));
      await repositories.users.save(
        User.register("user-2", identity({ id: STRANGER_DISCORD_ID, username: "bob" }), NOW),
      );
      await repositories.sessions.save(Session.open("hash-a1", "user-1", NOW));
      await repositories.sessions.save(Session.open("hash-a2", "user-1", NOW));
      await repositories.sessions.save(Session.open("hash-b1", "user-2", NOW));

      expect(await repositories.sessions.deleteByUserId("user-1")).toBe(2);
      expect(await repositories.sessions.findByTokenHash("hash-a1")).toBeNull();
      expect(await repositories.sessions.findByTokenHash("hash-b1")).not.toBeNull();
    });
  });

  describe(`${name} — GuestRepository`, () => {
    let guests: GuestRepository;
    beforeEach(() => {
      guests = create().guests;
    });

    const guest = (discordId: string, addedAt: Date, label: string | null = null): Guest => ({
      discordId,
      label,
      avatarHash: null,
      isAdmin: false,
      addedBy: ADA_DISCORD_ID,
      addedAt,
    });

    test("knows nobody at first", async () => {
      expect(await guests.find(STRANGER_DISCORD_ID)).toBeNull();
      expect(await guests.list()).toEqual([]);
    });

    test("round-trips a guest without changing any field", async () => {
      const added = { ...guest(STRANGER_DISCORD_ID, NOW, "Bob"), avatarHash: "b0b", isAdmin: true };

      await guests.add(added);

      expect(await guests.find(STRANGER_DISCORD_ID)).toEqual(added);
      expect(await guests.list()).toEqual([added]);
    });

    test("makes a guest an admin and back, and says when there was nobody", async () => {
      await guests.add(guest(STRANGER_DISCORD_ID, NOW));

      expect(await guests.setAdmin(STRANGER_DISCORD_ID, true)).toBe(true);
      expect((await guests.find(STRANGER_DISCORD_ID))?.isAdmin).toBe(true);
      expect(await guests.setAdmin(STRANGER_DISCORD_ID, false)).toBe(true);
      expect((await guests.find(STRANGER_DISCORD_ID))?.isAdmin).toBe(false);
      expect(await guests.setAdmin("999999999999999999", true)).toBe(false);
    });

    test("lists the newest guest first", async () => {
      await guests.add(guest("111111111111111111", NOW));
      await guests.add(guest("222222222222222222", new Date(NOW.getTime() + 1000)));

      expect((await guests.list()).map((one) => one.discordId)).toEqual([
        "222222222222222222",
        "111111111111111111",
      ]);
    });

    test("refuses to add the same person twice", async () => {
      await guests.add(guest(STRANGER_DISCORD_ID, NOW));

      await expect(guests.add(guest(STRANGER_DISCORD_ID, NOW))).rejects.toThrow();
    });

    test("removes a guest, and says whether there was one", async () => {
      await guests.add(guest(STRANGER_DISCORD_ID, NOW));

      expect(await guests.remove(STRANGER_DISCORD_ID)).toBe(true);
      expect(await guests.find(STRANGER_DISCORD_ID)).toBeNull();
      expect(await guests.remove(STRANGER_DISCORD_ID)).toBe(false);
    });
  });

  describe(`${name} — AccessRequestRepository`, () => {
    let requests: AccessRequestRepository;
    beforeEach(() => {
      requests = create().accessRequests;
    });

    const request = (discordId: string, requestedAt: Date, username = "bob"): AccessRequest => ({
      discordId,
      username,
      globalName: null,
      avatarHash: null,
      requestedAt,
    });

    test("round-trips a request without changing any field", async () => {
      const made = { ...request(STRANGER_DISCORD_ID, NOW), globalName: "Bob", avatarHash: "b0b" };

      await requests.record(made);

      expect(await requests.find(STRANGER_DISCORD_ID)).toEqual(made);
      expect(await requests.list()).toEqual([made]);
    });

    test("finds nothing for somebody who never asked", async () => {
      expect(await requests.find(STRANGER_DISCORD_ID)).toBeNull();
    });

    test("refreshes a request made again instead of adding another", async () => {
      await requests.record(request(STRANGER_DISCORD_ID, NOW, "bob"));
      const later = new Date(NOW.getTime() + 60_000);

      await requests.record(request(STRANGER_DISCORD_ID, later, "bobby"));

      expect(await requests.list()).toEqual([request(STRANGER_DISCORD_ID, later, "bobby")]);
    });

    test("lists the newest request first", async () => {
      await requests.record(request("111111111111111111", NOW));
      await requests.record(request("222222222222222222", new Date(NOW.getTime() + 1000)));

      expect((await requests.list()).map((one) => one.discordId)).toEqual([
        "222222222222222222",
        "111111111111111111",
      ]);
    });

    test(`keeps only the newest ${MAX_ACCESS_REQUESTS}`, async () => {
      for (let index = 0; index <= MAX_ACCESS_REQUESTS; index += 1) {
        const discordId = String(100_000_000_000_000_000n + BigInt(index));
        await requests.record(request(discordId, new Date(NOW.getTime() + index * 1000)));
      }

      const kept = await requests.list();
      expect(kept).toHaveLength(MAX_ACCESS_REQUESTS);
      expect(await requests.find("100000000000000000")).toBeNull();
    });

    test("removes a request, and says whether there was one", async () => {
      await requests.record(request(STRANGER_DISCORD_ID, NOW));

      expect(await requests.remove(STRANGER_DISCORD_ID)).toBe(true);
      expect(await requests.remove(STRANGER_DISCORD_ID)).toBe(false);
    });

    test("purges only requests made before the cutoff", async () => {
      await requests.record(request("111111111111111111", new Date(NOW.getTime() - 1)));
      await requests.record(request("222222222222222222", NOW));

      expect(await requests.purgeBefore(NOW)).toBe(1);
      expect((await requests.list()).map((one) => one.discordId)).toEqual(["222222222222222222"]);
    });
  });
}
