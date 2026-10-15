import { describe, expect, test } from "bun:test";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { InvalidIdentity } from "@/modules/identity/domain/errors.ts";
import { adaProfile } from "@/modules/identity/tests/support/fakes.ts";

describe("DiscordIdentity.fromProfile", () => {
  test("keeps the id, username, display name and avatar Discord sent", () => {
    const identity = DiscordIdentity.fromProfile(adaProfile({ avatarHash: "a1b2" }));

    expect(identity.discordId).toBe("80351110224678912");
    expect(identity.username).toBe("ada");
    expect(identity.globalName).toBe("Ada Lovelace");
    expect(identity.avatarHash).toBe("a1b2");
  });

  test("refuses an id that is not a Discord snowflake", () => {
    expect(() => DiscordIdentity.fromProfile(adaProfile({ id: "12ab" }))).toThrow(InvalidIdentity);
  });

  test("refuses a blank username", () => {
    expect(() => DiscordIdentity.fromProfile(adaProfile({ username: "  " }))).toThrow(
      InvalidIdentity,
    );
  });

  test("treats a blank display name as no display name", () => {
    expect(DiscordIdentity.fromProfile(adaProfile({ globalName: "  " })).globalName).toBeNull();
  });

  test("trims the names it keeps", () => {
    const identity = DiscordIdentity.fromProfile(
      adaProfile({ username: " ada ", globalName: " Ada " }),
    );

    expect(identity.username).toBe("ada");
    expect(identity.globalName).toBe("Ada");
  });
});
