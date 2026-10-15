import { describe, expect, test } from "bun:test";
import { AllowedDiscordUsers } from "@/modules/identity/domain/AllowedDiscordUsers.ts";
import { NotAllowed } from "@/modules/identity/domain/errors.ts";

const allowed = AllowedDiscordUsers.of(["80351110224678912", "123456789012345678"]);

describe("AllowedDiscordUsers", () => {
  test("allows an id on the list", () => {
    expect(allowed.allows("80351110224678912")).toBe(true);
  });

  test("does not allow an id that is not on the list", () => {
    expect(allowed.allows("999999999999999999")).toBe(false);
  });

  test("admits someone on the list without complaint", () => {
    expect(() => allowed.admit("123456789012345678")).not.toThrow();
  });

  test("turns away anyone else with NotAllowed", () => {
    expect(() => allowed.admit("999999999999999999")).toThrow(NotAllowed);
  });

  test("does not match on a prefix or a near miss", () => {
    expect(allowed.allows("8035111022467891")).toBe(false);
    expect(allowed.allows(" 80351110224678912")).toBe(false);
  });
});
