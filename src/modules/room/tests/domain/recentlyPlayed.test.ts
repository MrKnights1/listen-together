import { describe, expect, test } from "bun:test";
import { MIN_PLAYED_MS, RECENTLY_PLAYED } from "@/modules/room/domain/limits.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { apply, finishSong, NOW, songs } from "@/modules/room/tests/support/room.ts";

/** A room with `count` of Ada's songs queued, the first playing from NOW. */
function room(count: number, ownerId = "ada"): RoomState {
  return apply(emptyRoom(), { type: "add", ownerId, tracks: songs(ownerId, count) });
}

const playingEntry = (state: RoomState) => {
  const entryId = state.current?.entryId;
  if (entryId === undefined) throw new Error("nothing is playing");
  return entryId;
};
const trackOf = (state: RoomState, entryId: string) => {
  const trackId = state.entries[entryId]?.trackId;
  if (trackId === undefined) throw new Error(`no entry ${entryId}`);
  return trackId;
};
const played = (state: RoomState) => state.played.map((song) => song.trackId);

describe("Recently played", () => {
  test("remembers a song that played to its end, with who queued it and when", () => {
    const start = room(2);
    const first = trackOf(start, playingEntry(start));

    const { state, now } = finishSong(start, NOW);

    expect(state.played).toEqual([{ trackId: first, ownerId: "ada", at: now }]);
  });

  test("remembers a song skipped once it was heard", () => {
    const start = room(2);
    const first = trackOf(start, playingEntry(start));

    const state = apply(start, { type: "skip", entryId: playingEntry(start) }, NOW + MIN_PLAYED_MS);

    expect(played(state)).toEqual([first]);
  });

  test("forgets a song skipped before it was heard", () => {
    const start = room(2);

    const state = apply(
      start,
      { type: "skip", entryId: playingEntry(start) },
      NOW + MIN_PLAYED_MS - 1,
    );

    expect(state.played).toEqual([]);
  });

  test("judges a skip in a paused room by where it was paused, not by the clock", () => {
    const start = room(2);
    const paused = apply(start, { type: "pause", entryId: playingEntry(start) }, NOW + 5_000);

    const state = apply(paused, { type: "skip", entryId: playingEntry(paused) }, NOW + 600_000);

    expect(state.played).toEqual([]);
  });

  test("never remembers a song removed or cleared from the queue", () => {
    const start = room(3);
    const [queued] = start.queue;
    if (queued === undefined) throw new Error("expected a queued song");

    let state = apply(start, { type: "remove", entryId: queued });
    state = apply(state, { type: "clear", addedUpTo: NOW });

    expect(state.played).toEqual([]);
  });

  test("lists the newest first", () => {
    const start = room(3);
    const first = trackOf(start, playingEntry(start));
    const once = finishSong(start, NOW);
    const second = trackOf(once.state, playingEntry(once.state));

    const twice = finishSong(once.state, once.now);

    expect(played(twice.state)).toEqual([second, first]);
  });

  test("on repeat-one, keeps no row per loop, and lists the song once the room leaves it", () => {
    const start = apply(room(2), { type: "repeat", mode: "one" });
    const first = trackOf(start, playingEntry(start));

    let step = finishSong(start, NOW);
    step = finishSong(step.state, step.now);
    expect(step.state.played).toEqual([]);

    const left = apply(
      step.state,
      { type: "skip", entryId: playingEntry(step.state) },
      step.now + MIN_PLAYED_MS,
    );
    expect(played(left)).toEqual([first]);
  });

  test("on repeat-all, lists a song once however often it comes round, newest place first", () => {
    let step = { state: apply(room(2), { type: "repeat", mode: "all" }), now: NOW };
    const order: string[] = [];
    for (let round = 0; round < 4; round += 1) {
      order.push(trackOf(step.state, playingEntry(step.state)));
      step = finishSong(step.state, step.now);
    }

    expect(played(step.state)).toEqual(order.slice(2).reverse());
  });

  test("lists a song two people queued once, under whoever queued it last", () => {
    const song = (entryId: string, trackId: string) => ({ entryId, trackId, durationMs: 200_000 });
    let state = apply(emptyRoom(), {
      type: "add",
      ownerId: "ada",
      tracks: [song("a1", "youtube:other"), song("a2", "youtube:same")],
    });
    // Ada's "other" plays, so Bob may queue the song Ada has waiting too.
    state = apply(state, { type: "add", ownerId: "bob", tracks: [song("b1", "youtube:same")] });
    let step = { state, now: NOW };
    for (let index = 0; index < 3; index += 1) step = finishSong(step.state, step.now);

    expect(step.state.played[0]).toEqual({ trackId: "youtube:same", ownerId: "bob", at: step.now });
    expect(step.state.played.map((one) => [one.trackId, one.ownerId])).toEqual([
      ["youtube:same", "bob"],
      ["youtube:other", "ada"],
    ]);
  });

  test(`keeps only the latest ${RECENTLY_PLAYED}`, () => {
    let step = { state: room(RECENTLY_PLAYED + 3), now: NOW };
    const order: string[] = [];
    while (step.state.current !== null) {
      order.push(trackOf(step.state, playingEntry(step.state)));
      step = finishSong(step.state, step.now);
    }

    expect(played(step.state)).toEqual(order.reverse().slice(0, RECENTLY_PLAYED));
  });

  test("remembers nothing when an idle room starts its first song", () => {
    expect(room(1).played).toEqual([]);
  });
});
