import { beforeEach, describe, expect, test } from "bun:test";
import { AccessList } from "@/modules/identity/application/AccessList.ts";
import { AddGuest } from "@/modules/identity/application/AddGuest.ts";
import { DeclineAccessRequest } from "@/modules/identity/application/DeclineAccessRequest.ts";
import { GetGuestList } from "@/modules/identity/application/GetGuestList.ts";
import { PurgeStaleAccessRequests } from "@/modules/identity/application/PurgeStaleAccessRequests.ts";
import { RemoveGuest } from "@/modules/identity/application/RemoveGuest.ts";
import { SetGuestAdmin } from "@/modules/identity/application/SetGuestAdmin.ts";
import { ACCESS_REQUEST_RETENTION_MS } from "@/modules/identity/domain/AccessRequest.ts";
import { Hosts } from "@/modules/identity/domain/Hosts.ts";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { Session } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import {
  ADA_DISCORD_ID,
  adaProfile,
  FakeClock,
  InMemoryAccessRequestRepository,
  InMemoryGuestRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  STRANGER_DISCORD_ID,
} from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");
const BOB = STRANGER_DISCORD_ID;
const CY = "333333333333333333";

let clock: FakeClock;
let users: InMemoryUserRepository;
let sessions: InMemorySessionRepository;
let guests: InMemoryGuestRepository;
let requests: InMemoryAccessRequestRepository;
let hosts: Hosts;
let addGuest: AddGuest;

beforeEach(() => {
  clock = new FakeClock(NOW);
  users = new InMemoryUserRepository();
  sessions = new InMemorySessionRepository();
  guests = new InMemoryGuestRepository();
  requests = new InMemoryAccessRequestRepository();
  hosts = Hosts.of([ADA_DISCORD_ID]);
  addGuest = new AddGuest(hosts, guests, requests, clock);
});

async function bobAsks(): Promise<void> {
  await requests.record({
    discordId: BOB,
    username: "bob",
    globalName: "Bob",
    avatarHash: "b0b",
    requestedAt: NOW,
  });
}

async function bobHasSignedIn(): Promise<User> {
  return await users.save(
    User.register(
      "user-bob",
      DiscordIdentity.fromProfile(adaProfile({ id: BOB, username: "bob", globalName: "Bobby" })),
      NOW,
    ),
  );
}

describe("AccessList", () => {
  test("lets in hosts and guests, and nobody else", async () => {
    await guests.add({
      discordId: BOB,
      label: null,
      avatarHash: null,
      isAdmin: false,
      addedBy: ADA_DISCORD_ID,
      addedAt: NOW,
    });
    const access = new AccessList(hosts, guests);

    expect(await access.allows(ADA_DISCORD_ID)).toBe(true);
    expect(await access.allows(BOB)).toBe(true);
    expect(await access.allows(CY)).toBe(false);
  });

  test("counts the hosts as admins, and a guest only once made one", async () => {
    const access = new AccessList(hosts, guests);

    expect(await access.isAdmin(ADA_DISCORD_ID)).toBe(true);
    expect(await access.isAdmin(BOB)).toBe(false);
  });
});

describe("AddGuest", () => {
  test("approving a request lets them in under their Discord name and picture, and clears the request", async () => {
    await bobAsks();

    expect(await addGuest.execute(ADA_DISCORD_ID, BOB, null)).toBe("added");

    expect(await guests.list()).toEqual([
      {
        discordId: BOB,
        label: "Bob",
        avatarHash: "b0b",
        isAdmin: false,
        addedBy: ADA_DISCORD_ID,
        addedAt: NOW,
      },
    ]);
    expect(await requests.list()).toEqual([]);
  });

  test("adds somebody by id who never asked, under the name the host typed", async () => {
    expect(await addGuest.execute(ADA_DISCORD_ID, ` ${CY} `, "  Cy  ")).toBe("added");

    expect(await guests.list()).toEqual([
      {
        discordId: CY,
        label: "Cy",
        avatarHash: null,
        isAdmin: false,
        addedBy: ADA_DISCORD_ID,
        addedAt: NOW,
      },
    ]);
  });

  test("prefers the name the host typed over the one from the request", async () => {
    await bobAsks();

    await addGuest.execute(ADA_DISCORD_ID, BOB, "Bob from work");

    expect((await guests.list())[0]?.label).toBe("Bob from work");
  });

  test.each([
    ["not a number", "bob"],
    ["too short", "1234"],
    ["too long", "123456789012345678901"],
    ["empty", ""],
  ])("refuses an id that is %s", async (_, id) => {
    expect(await addGuest.execute(ADA_DISCORD_ID, id, null)).toBe("invalid_id");
    expect(await guests.list()).toEqual([]);
  });

  test("refuses a name longer than 80 characters", async () => {
    expect(await addGuest.execute(ADA_DISCORD_ID, BOB, "x".repeat(81))).toBe("invalid_label");
  });

  test("refuses to add a host: hosts are always let in", async () => {
    expect(await addGuest.execute(ADA_DISCORD_ID, ADA_DISCORD_ID, null)).toBe("already_host");
  });

  test("refuses to add somebody twice", async () => {
    await addGuest.execute(ADA_DISCORD_ID, BOB, null);

    expect(await addGuest.execute(ADA_DISCORD_ID, BOB, null)).toBe("already_guest");
  });
});

describe("SetGuestAdmin", () => {
  test("makes a guest an admin, which lets them manage guests, and takes it back", async () => {
    await addGuest.execute(ADA_DISCORD_ID, BOB, null);
    const setAdmin = new SetGuestAdmin(hosts, guests);
    const access = new AccessList(hosts, guests);

    expect(await setAdmin.execute(BOB, true)).toBe("updated");
    expect(await access.isAdmin(BOB)).toBe(true);

    expect(await setAdmin.execute(BOB, false)).toBe("updated");
    expect(await access.isAdmin(BOB)).toBe(false);
    expect(await access.allows(BOB)).toBe(true);
  });

  test("leaves the hosts alone: the server's configuration decides them", async () => {
    expect(await new SetGuestAdmin(hosts, guests).execute(ADA_DISCORD_ID, false)).toBe("is_host");
  });

  test("says when there is no such guest", async () => {
    expect(await new SetGuestAdmin(hosts, guests).execute(CY, true)).toBe("not_found");
  });
});

describe("DeclineAccessRequest", () => {
  test("forgets the request, and says when there was none", async () => {
    await bobAsks();
    const decline = new DeclineAccessRequest(requests);

    expect(await decline.execute(BOB)).toBe("declined");
    expect(await requests.list()).toEqual([]);
    expect(await decline.execute(BOB)).toBe("not_found");
  });
});

describe("RemoveGuest", () => {
  let removeGuest: RemoveGuest;
  let revoked: string[];

  beforeEach(() => {
    removeGuest = new RemoveGuest(hosts, guests, users, sessions);
    revoked = [];
    removeGuest.onAccessRevoked((userId) => revoked.push(userId));
  });

  test("takes them off the list, ends their sessions and says so", async () => {
    await addGuest.execute(ADA_DISCORD_ID, BOB, null);
    const bob = await bobHasSignedIn();
    await sessions.save(Session.open("hash-bob", bob.id, NOW));

    expect(await removeGuest.execute(BOB)).toBe("removed");

    expect(await guests.find(BOB)).toBeNull();
    expect(await sessions.findByTokenHash("hash-bob")).toBeNull();
    expect(revoked).toEqual(["user-bob"]);
  });

  test("removes a guest who never signed in, with nothing to close", async () => {
    await addGuest.execute(ADA_DISCORD_ID, CY, null);

    expect(await removeGuest.execute(CY)).toBe("removed");
    expect(revoked).toEqual([]);
  });

  test("refuses to remove a host", async () => {
    expect(await removeGuest.execute(ADA_DISCORD_ID)).toBe("is_host");
  });

  test("says when there was nobody to remove", async () => {
    expect(await removeGuest.execute(BOB)).toBe("not_found");
    expect(revoked).toEqual([]);
  });

  test("a failing listener does not undo the removal", async () => {
    await addGuest.execute(ADA_DISCORD_ID, BOB, null);
    await bobHasSignedIn();
    removeGuest.onAccessRevoked(() => {
      throw new Error("socket table on fire");
    });

    expect(await removeGuest.execute(BOB)).toBe("removed");
    expect(await guests.find(BOB)).toBeNull();
  });
});

describe("GetGuestList", () => {
  test("names a guest the way Discord does once they have signed in, and by the host's label before", async () => {
    await addGuest.execute(ADA_DISCORD_ID, CY, "Cy");
    await addGuest.execute(ADA_DISCORD_ID, BOB, "Bob from work");
    await bobHasSignedIn();

    const listing = await new GetGuestList(hosts, guests, requests, users).execute();

    const byId = Object.fromEntries(listing.guests.map((guest) => [guest.discordId, guest]));
    expect(byId[BOB]).toMatchObject({ name: "Bobby", label: "Bob from work", hasSignedIn: true });
    expect(byId[CY]).toMatchObject({ name: "Cy", label: "Cy", hasSignedIn: false, isAdmin: false });
    expect(byId[CY]?.avatarUrl).toStartWith("https://cdn.discordapp.com/embed/avatars/");
  });

  test("shows who is waiting, with the name and picture Discord gave them", async () => {
    await bobAsks();

    const { requests: waiting } = await new GetGuestList(hosts, guests, requests, users).execute();

    expect(waiting).toEqual([
      {
        discordId: BOB,
        name: "Bob",
        username: "bob",
        avatarUrl: `https://cdn.discordapp.com/avatars/${BOB}/b0b.png?size=64`,
        requestedAt: NOW,
      },
    ]);
  });

  test("lists the hosts, by id until they have signed in", async () => {
    const { hosts: listed } = await new GetGuestList(hosts, guests, requests, users).execute();

    expect(listed.map((host) => [host.discordId, host.name])).toEqual([
      [ADA_DISCORD_ID, ADA_DISCORD_ID],
    ]);
    expect(listed[0]?.avatarUrl).toStartWith("https://cdn.discordapp.com/embed/avatars/");
  });

  test("names a host the way Discord does once they have signed in", async () => {
    await users.save(User.register("user-ada", DiscordIdentity.fromProfile(adaProfile()), NOW));

    const { hosts: listed } = await new GetGuestList(hosts, guests, requests, users).execute();

    expect(listed[0]?.name).toBe("Ada Lovelace");
  });
});

describe("PurgeStaleAccessRequests", () => {
  test("forgets requests older than 30 days and keeps the rest", async () => {
    await bobAsks();
    clock.advance(ACCESS_REQUEST_RETENTION_MS);
    await requests.record({
      discordId: CY,
      username: "cy",
      globalName: null,
      avatarHash: null,
      requestedAt: clock.now(),
    });
    clock.advance(1);

    expect(await new PurgeStaleAccessRequests(requests, clock).execute()).toBe(1);
    expect((await requests.list()).map((request) => request.discordId)).toEqual([CY]);
  });
});
