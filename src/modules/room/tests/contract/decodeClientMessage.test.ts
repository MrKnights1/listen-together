import { describe, expect, test } from "bun:test";
import { decodeClientMessage } from "@/modules/room/contract/decodeClientMessage.ts";
import { MAX_MESSAGE_BYTES, MAX_URL_LENGTH } from "@/modules/room/contract/messages.ts";

const decode = (value: unknown) => decodeClientMessage(JSON.stringify(value));
const ENTRY = "3f1c2b7e-1d2a-4c5b-9e8f-0a1b2c3d4e5f";

describe("decodeClientMessage — accepted", () => {
  test.each([
    [{ t: "ping", id: 7, c: 1234.5 }],
    [{ t: "resync" }],
    [{ t: "presence", listening: true, sync: "in_sync", errorCode: null }],
    [{ t: "presence", listening: false, sync: "error", errorCode: 150 }],
    [
      {
        t: "cmd",
        id: "c1",
        op: { type: "add", url: "https://youtu.be/dQw4w9WgXcQ", scope: "song" },
      },
    ],
    [
      {
        t: "cmd",
        id: "c11",
        op: { type: "add", url: "https://youtu.be/x?list=PL", scope: "playlist" },
      },
    ],
    [{ t: "cmd", id: "c2", op: { type: "pause", entryId: ENTRY } }],
    [{ t: "cmd", id: "c3", op: { type: "resume", entryId: ENTRY } }],
    [{ t: "cmd", id: "c4", op: { type: "skip", entryId: ENTRY } }],
    [{ t: "cmd", id: "c5", op: { type: "remove", entryId: ENTRY } }],
    [{ t: "cmd", id: "c6", op: { type: "seek", entryId: ENTRY, positionMs: 90_000 } }],
    [{ t: "cmd", id: "c7", op: { type: "move", entryId: ENTRY, toIndex: 0 } }],
    [{ t: "cmd", id: "c9", op: { type: "shuffle", ownerId: ENTRY } }],
    [{ t: "cmd", id: "c10", op: { type: "repeat", mode: "all" } }],
    [{ t: "cmd", id: "c12", op: { type: "set_shuffle", on: true } }],
    [{ t: "cmd", id: "c13", op: { type: "set_shuffle", on: false } }],
    [{ t: "cmd", id: "c14", op: { type: "clear", addedUpTo: 1_760_000_000_000 } }],
    [{ t: "cmd", id: "c15", op: { type: "star", entryId: ENTRY, on: true } }],
    [{ t: "cmd", id: "c16", op: { type: "star", entryId: ENTRY, on: false } }],
  ])("%o", (message) => {
    expect(decode(message)).toEqual(message as never);
  });
});

describe("decodeClientMessage — refused", () => {
  test.each([
    ["not JSON", "{oops"],
    ["a JSON array", "[1,2]"],
    ["a JSON string", '"ping"'],
    ["no type", "{}"],
    ["an unknown type", JSON.stringify({ t: "hello" })],
    ["an extra field", JSON.stringify({ t: "resync", admin: true })],
    ["a ping with a fractional id", JSON.stringify({ t: "ping", id: 1.5, c: 1 })],
    ["a ping without its clock", JSON.stringify({ t: "ping", id: 1 })],
    [
      "a command id with spaces",
      JSON.stringify({ t: "cmd", id: "a b", op: { type: "skip", entryId: ENTRY } }),
    ],
    [
      "a command id that is too long",
      JSON.stringify({ t: "cmd", id: "x".repeat(65), op: { type: "skip", entryId: ENTRY } }),
    ],
    [
      "an unknown command",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "track_ended", entryId: ENTRY } }),
    ],
    [
      "the room's own auto-pause",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "auto_pause" } }),
    ],
    [
      "an entry id with a path in it",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "skip", entryId: "../x" } }),
    ],
    [
      "a negative seek",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "seek", entryId: ENTRY, positionMs: -1 } }),
    ],
    [
      "a seek past a day",
      JSON.stringify({
        t: "cmd",
        id: "c",
        op: { type: "seek", entryId: ENTRY, positionMs: 86_400_001 },
      }),
    ],
    [
      "a seek to a string",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "seek", entryId: ENTRY, positionMs: "9" } }),
    ],
    [
      "a negative move",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "move", entryId: ENTRY, toIndex: -1 } }),
    ],
    [
      "an unknown repeat mode",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "repeat", mode: "forever" } }),
    ],
    [
      "a one-time shuffle of the whole queue, which is now a switch",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "shuffle", ownerId: null } }),
    ],
    [
      "a shuffle switch set to a word",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "set_shuffle", on: "yes" } }),
    ],
    [
      "a shuffle switch with an extra field",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "set_shuffle", on: true, seed: 4 } }),
    ],
    [
      "a star that does not say on or off",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "star", entryId: "e1" } }),
    ],
    [
      "a star set to a word",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "star", entryId: "e1", on: "yes" } }),
    ],
    [
      "a star for an id that is not ours",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "star", entryId: "e 1", on: true } }),
    ],
    [
      "a star with an extra field",
      JSON.stringify({
        t: "cmd",
        id: "c",
        op: { type: "star", entryId: "e1", on: true, place: 0 },
      }),
    ],
    ["a clear without its bound", JSON.stringify({ t: "cmd", id: "c", op: { type: "clear" } })],
    [
      "a clear bounded by a negative time",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "clear", addedUpTo: -1 } }),
    ],
    [
      "a clear bounded by a fraction",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "clear", addedUpTo: 1.5 } }),
    ],
    [
      "a clear bounded by a word",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "clear", addedUpTo: "now" } }),
    ],
    [
      "a clear with an extra field",
      JSON.stringify({
        t: "cmd",
        id: "c",
        op: { type: "clear", addedUpTo: 1, ownerId: "ada" },
      }),
    ],
    [
      "an add with a number for a link",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "add", url: 42, scope: "song" } }),
    ],
    [
      "an add that does not say song or playlist",
      JSON.stringify({ t: "cmd", id: "c", op: { type: "add", url: "https://youtu.be/x" } }),
    ],
    [
      "an add with an unknown scope",
      JSON.stringify({
        t: "cmd",
        id: "c",
        op: { type: "add", url: "https://youtu.be/x", scope: "everything" },
      }),
    ],
    [
      "an add with an over-long link",
      JSON.stringify({
        t: "cmd",
        id: "c",
        op: { type: "add", url: "a".repeat(MAX_URL_LENGTH + 1), scope: "song" },
      }),
    ],
    [
      "presence with an unknown sync state",
      JSON.stringify({ t: "presence", listening: true, sync: "great", errorCode: null }),
    ],
    [
      "presence with a string error code",
      JSON.stringify({ t: "presence", listening: true, sync: "error", errorCode: "150" }),
    ],
    [
      "presence with an extra field",
      JSON.stringify({ t: "presence", listening: true, sync: "idle", errorCode: null, x: 1 }),
    ],
  ])("%s", (_name, raw) => {
    expect(decodeClientMessage(raw)).toBeNull();
  });

  test("a message bigger than the limit, before it is even parsed", () => {
    const big = JSON.stringify({ t: "resync", pad: "x".repeat(MAX_MESSAGE_BYTES) });

    expect(decodeClientMessage(big)).toBeNull();
  });

  test("a binary frame", () => {
    expect(
      decodeClientMessage(new TextEncoder().encode(JSON.stringify({ t: "resync" }))),
    ).toBeNull();
  });

  test("a prototype-polluting key", () => {
    expect(decodeClientMessage('{"t":"resync","__proto__":{"admin":true}}')).toBeNull();
  });
});
