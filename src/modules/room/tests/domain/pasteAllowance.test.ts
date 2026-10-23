import { describe, expect, test } from "bun:test";
import { MAX_ROOM_ENTRIES } from "@/modules/room/domain/limits.ts";
import { emptyRoom, pasteAllowance } from "@/modules/room/domain/RoomState.ts";
import { apply, songs } from "@/modules/room/tests/support/room.ts";

describe("pasteAllowance", () => {
  test("is the whole room when it is empty", () => {
    expect(pasteAllowance(emptyRoom(), "ada")).toBe(MAX_ROOM_ENTRIES);
  });

  test("is every free place, plus the person's own songs and the one playing, which come back as duplicates", () => {
    let room = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 3) });
    room = apply(room, { type: "add", ownerId: "bob", tracks: songs("bob", 2) });

    // Five in the room: Ada's first plays, two of hers and Bob's two wait.
    expect(pasteAllowance(room, "ada")).toBe(MAX_ROOM_ENTRIES - 5 + 2 + 1);
    expect(pasteAllowance(room, "bob")).toBe(MAX_ROOM_ENTRIES - 5 + 2 + 1);
    expect(pasteAllowance(room, "cy")).toBe(MAX_ROOM_ENTRIES - 5 + 0 + 1);
  });

  test("is only what could come back as duplicates once the room is full", () => {
    const full = apply(emptyRoom(), {
      type: "add",
      ownerId: "ada",
      tracks: songs("ada", MAX_ROOM_ENTRIES),
    });

    expect(pasteAllowance(full, "bob")).toBe(1);
    expect(pasteAllowance(full, "ada")).toBe(MAX_ROOM_ENTRIES - 1 + 1);
  });
});
