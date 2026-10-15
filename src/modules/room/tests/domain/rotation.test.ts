import { describe, expect, test } from "bun:test";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { upcoming } from "@/modules/room/domain/upcoming.ts";
import { apply, finishSong, NOW, playingOwner, songs } from "@/modules/room/tests/support/room.ts";

/** Plays the room through, returning whose song played, in order. */
function playOrder(start: RoomState, songsToPlay: number): string[] {
  const owners: string[] = [];
  let state = start;
  let now = NOW;
  for (let played = 0; played < songsToPlay && state.current !== null; played += 1) {
    owners.push(playingOwner(state) ?? "?");
    ({ state, now } = finishSong(state, now));
  }
  return owners;
}

describe("fair rotation", () => {
  test("an idle room starts playing the first song added", () => {
    const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });

    expect(state.current?.status).toBe("playing");
    expect(playingOwner(state)).toBe("ada");
    expect(state.current?.anchorAt).toBe(NOW);
  });

  /** The reason the rotation exists. */
  test("one person's long playlist does not take over: turns alternate", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 50) });
    state = apply(state, { type: "add", ownerId: "bob", tracks: songs("bob", 2) });

    expect(playOrder(state, 6)).toEqual(["ada", "bob", "ada", "bob", "ada", "ada"]);
  });

  test("three people take turns in the order they joined", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 3) });
    state = apply(state, { type: "add", ownerId: "bob", tracks: songs("bob", 3) });
    state = apply(state, { type: "add", ownerId: "cy", tracks: songs("cy", 3) });

    expect(playOrder(state, 7)).toEqual(["ada", "bob", "cy", "ada", "bob", "cy", "ada"]);
  });

  test("someone joining late waits behind everybody already waiting", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 3) });
    state = apply(state, { type: "add", ownerId: "bob", tracks: songs("bob", 3) });
    ({ state } = finishSong(state, NOW)); // ada played, bob now
    state = apply(state, { type: "add", ownerId: "cy", tracks: songs("cy", 3) });

    // bob is playing; ada was already waiting, so she goes before cy.
    expect(playOrder(state, 4)).toEqual(["bob", "ada", "cy", "bob"]);
  });

  test("adding more songs does not move you up the line", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 2) });
    state = apply(state, { type: "add", ownerId: "bob", tracks: songs("bob", 2) });
    state = apply(state, { type: "add", ownerId: "ada", tracks: songs("ada", 5) });

    expect(playOrder(state, 4)).toEqual(["ada", "bob", "ada", "bob"]);
  });

  test("the room goes idle when the last song ends with repeat off", () => {
    const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });

    expect(finishSong(state, NOW).state.current).toBeNull();
  });

  test("a person's songs play in the order they queued them", () => {
    const mine = songs("ada", 3);
    const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: mine });

    expect([state.current?.entryId, ...upcoming(state)]).toEqual(mine.map((one) => one.entryId));
  });
});
