import { describe, expect, test } from "bun:test";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { apply, finishSong, NOW, songs } from "@/modules/room/tests/support/room.ts";

/** Lets every song run out, and lists the order they played in. */
function playOrder(state: RoomState, now = NOW): string[] {
  const played: string[] = [];
  let room = state;
  let at = now;
  while (room.current !== null && played.length < 50) {
    played.push(room.current.entryId);
    ({ state: room, now: at } = finishSong(room, at));
  }
  return played;
}

const ids = (tracks: { entryId: string }[]) => tracks.map((track) => track.entryId);

describe("the queue plays in the order songs were added", () => {
  test("an idle room starts playing the first song added", () => {
    const [first, second] = songs("ada", 2);
    if (first === undefined || second === undefined) throw new Error("no songs");

    const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: [first, second] });

    expect(state.current?.entryId).toBe(first.entryId);
    expect(state.queue).toEqual([second.entryId]);
  });

  test("whoever added them, songs play first come, first played", () => {
    const adas = songs("ada", 2);
    const bobs = songs("bob", 1);
    const more = songs("ada", 1);
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: adas });
    state = apply(state, { type: "add", ownerId: "bob", tracks: bobs });
    state = apply(state, { type: "add", ownerId: "ada", tracks: more });

    expect(playOrder(state)).toEqual([...ids(adas), ...ids(bobs), ...ids(more)]);
  });

  test("a playlist's songs stay together, in playlist order", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });
    const playlist = songs("bob", 4);
    state = apply(state, { type: "add", ownerId: "bob", tracks: playlist });
    const late = songs("cy", 1);
    state = apply(state, { type: "add", ownerId: "cy", tracks: late });

    expect(state.queue).toEqual([...ids(playlist), ...ids(late)]);
  });

  test("the room goes idle when the last song ends with repeat off", () => {
    const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });

    expect(finishSong(state, NOW).state.current).toBeNull();
  });

  test("repeat all comes back round to the first song after the last", () => {
    const tracks = songs("ada", 3);
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks });
    state = apply(state, { type: "repeat", mode: "all" });

    const order = ids(tracks);
    expect(playOrder(state).slice(0, 7)).toEqual([...order, ...order, ...order.slice(0, 1)]);
  });
});
