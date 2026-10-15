import { describe, expect, test } from "bun:test";
import { Hosts } from "@/modules/identity/domain/Hosts.ts";

const hosts = Hosts.of(["80351110224678912", "123456789012345678"]);

describe("Hosts", () => {
  test("includes an id on the list", () => {
    expect(hosts.includes("80351110224678912")).toBe(true);
  });

  test("does not include an id that is not on the list", () => {
    expect(hosts.includes("999999999999999999")).toBe(false);
  });

  test("does not match on a prefix or a near miss", () => {
    expect(hosts.includes("8035111022467891")).toBe(false);
    expect(hosts.includes(" 80351110224678912")).toBe(false);
  });

  test("lists the hosts in the order they were configured", () => {
    expect(hosts.list()).toEqual(["80351110224678912", "123456789012345678"]);
  });
});
