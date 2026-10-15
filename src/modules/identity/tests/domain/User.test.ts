import { describe, expect, test } from "bun:test";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { User } from "@/modules/identity/domain/User.ts";
import { adaProfile } from "@/modules/identity/tests/support/fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");
const LATER = new Date("2026-10-20T10:00:00.000Z");

function user(overrides: Parameters<typeof adaProfile>[0] = {}): User {
  return User.register("user-1", DiscordIdentity.fromProfile(adaProfile(overrides)), NOW);
}

describe("User", () => {
  test("is called by their Discord display name", () => {
    expect(user().displayName).toBe("Ada Lovelace");
  });

  test("falls back to their username when they never set a display name", () => {
    expect(user({ globalName: null }).displayName).toBe("ada");
  });

  test("shows their own avatar when they have one", () => {
    expect(user({ avatarHash: "a1b2c3" }).avatarUrl).toBe(
      "https://cdn.discordapp.com/avatars/80351110224678912/a1b2c3.png?size=64",
    );
  });

  /**
   * Expected indexes worked out independently (Python big integers):
   * 80351110224678912 >> 22 = 19157197529, % 6 = 5;
   * 123456789012345678 >> 22 = 29434392216, % 6 = 0.
   * With Number arithmetic the ids would already have lost precision.
   */
  test("shows Discord's default avatar for their id when they have none", () => {
    expect(user().avatarUrl).toBe("https://cdn.discordapp.com/embed/avatars/5.png");
    expect(user({ id: "123456789012345678" }).avatarUrl).toBe(
      "https://cdn.discordapp.com/embed/avatars/0.png",
    );
  });

  test("takes a fresh name and picture from Discord on every sign-in, keeping its id", () => {
    const again = user().signedInAgain(
      DiscordIdentity.fromProfile(adaProfile({ globalName: "Countess", avatarHash: "f00" })),
      LATER,
    );

    expect(again.id).toBe("user-1");
    expect(again.displayName).toBe("Countess");
    expect(again.avatarHash).toBe("f00");
    expect(again.createdAt).toEqual(NOW);
    expect(again.lastLoginAt).toEqual(LATER);
  });

  test("round-trips through a snapshot unchanged", () => {
    const original = user({ avatarHash: "a1" });

    expect(User.restore(original.toSnapshot()).toSnapshot()).toEqual(original.toSnapshot());
  });
});
