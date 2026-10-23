import { beforeEach, describe, expect, test } from "bun:test";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";
import type { RoomRepository } from "@/modules/room/domain/ports/RoomRepository.ts";
import { emptyRoom } from "@/modules/room/domain/RoomState.ts";
import { apply, NOW, songs } from "./room.ts";

/** Run against SQLite and the in-memory fakes, so the fakes cannot drift. */
export function runRoomRepositoryContracts(
  name: string,
  create: () => { rooms: RoomRepository; activity: ActivityRepository },
): void {
  describe(`${name} — RoomRepository`, () => {
    let rooms: RoomRepository;
    beforeEach(() => {
      rooms = create().rooms;
    });

    test("has no room before the first save", async () => {
      expect(await rooms.load()).toBeNull();
    });

    test("round-trips a busy room exactly", async () => {
      let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 3) });
      state = apply(state, { type: "add", ownerId: "bob", tracks: songs("bob", 2) });
      state = apply(state, { type: "repeat", mode: "all" });
      state = apply(state, { type: "set_shuffle", on: true });
      state = apply(state, { type: "star", entryId: state.queue[2] as string, on: true });
      state = apply(
        state,
        { type: "skip", entryId: state.current?.entryId as string },
        NOW + 60_000,
      );
      expect(state.played).toHaveLength(1);

      await rooms.save(state, 1234, false);

      expect(await rooms.load()).toEqual({ state, savedAt: 1234, cleanShutdown: false });
    });

    test("keeps only the latest save", async () => {
      await rooms.save(emptyRoom(), 1, true);
      const later = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });

      await rooms.save(later, 2, false);

      expect(await rooms.load()).toEqual({ state: later, savedAt: 2, cleanShutdown: false });
    });
  });

  describe(`${name} — ActivityRepository`, () => {
    let activity: ActivityRepository;
    beforeEach(() => {
      activity = create().activity;
    });

    test("hands back what it recorded, with an id", async () => {
      const entry = await activity.record({
        at: 10,
        actorId: "ada",
        kind: "skipped",
        detail: { title: "x" },
      });

      expect(entry).toEqual({
        id: entry.id,
        at: 10,
        actorId: "ada",
        kind: "skipped",
        detail: { title: "x" },
      });
    });

    test("keeps a room action with no actor", async () => {
      const entry = await activity.record({
        at: 10,
        actorId: null,
        kind: "auto_paused",
        detail: {},
      });

      expect((await activity.recent(1))[0]?.actorId).toBeNull();
      expect(entry.actorId).toBeNull();
    });

    test("lists the latest entries, oldest first", async () => {
      for (let at = 1; at <= 5; at += 1) {
        await activity.record({ at, actorId: "ada", kind: "paused", detail: {} });
      }

      expect((await activity.recent(3)).map((entry) => entry.at)).toEqual([3, 4, 5]);
    });

    test("purges only entries from before the cutoff", async () => {
      for (const at of [1, 2, 3])
        await activity.record({ at, actorId: null, kind: "paused", detail: {} });

      expect(await activity.purgeBefore(3)).toBe(2);
      expect((await activity.recent(10)).map((entry) => entry.at)).toEqual([3]);
    });
  });
}
