import { describe, expect, test } from "bun:test";
import type { RoomSnapshot, ServerMessage } from "@/modules/room/contract/messages.ts";
import { decide } from "@/modules/room/domain/decide.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { emptyClientRoom, receive, type ClientRoom } from "@/modules/room/ui/clientRoom.ts";
import { context, songs } from "@/modules/room/tests/support/room.ts";
import { trackInfo } from "@/modules/room/tests/support/fakes.ts";

function snapshot(state: RoomState = emptyRoom()): RoomSnapshot {
  return {
    state,
    tracks: [trackInfo("one")],
    activity: [],
    people: [
      { id: "ada", name: "Ada", avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png" },
    ],
  };
}

function welcomed(state: RoomState = emptyRoom()): ClientRoom {
  return receive(emptyClientRoom(), {
    t: "welcome",
    s: 1,
    you: "ada",
    room: snapshot(state),
    listeners: [],
  });
}

/** What the server would broadcast for a command applied to `state`. */
function eventFor(state: RoomState, command: Parameters<typeof decide>[1]): ServerMessage {
  const decision = decide(state, command, context());
  if (decision.kind !== "accepted") throw new Error("expected the command to apply");
  return {
    t: "ev",
    v: commit(state, decision.events).version,
    by: "ada",
    events: decision.events,
    tracks: [trackInfo("two")],
    activity: null,
  };
}

describe("receive", () => {
  test("ignores updates before the welcome: there is no room yet to apply them to", () => {
    const update = eventFor(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });

    expect(receive(emptyClientRoom(), update)).toEqual(emptyClientRoom());
  });

  test("takes the whole room from the welcome", () => {
    const room = welcomed();

    expect(room.you).toBe("ada");
    expect(room.tracks["youtube:one"]?.title).toBe("Song one");
    expect(room.people["ada"]?.name).toBe("Ada");
  });

  test("applies the next update with the same rules the server used", () => {
    const room = welcomed();
    const update = eventFor(room.state, { type: "add", ownerId: "ada", tracks: songs("ada", 2) });

    const next = receive(room, update);

    expect(next.state.version).toBe(1);
    expect(next.state.current).not.toBeNull();
    expect(next.tracks["youtube:two"]?.title).toBe("Song two");
  });

  test("ignores an update it already has", () => {
    const room = welcomed();
    const update = eventFor(room.state, { type: "add", ownerId: "ada", tracks: songs("ada", 1) });
    const once = receive(room, update);

    expect(receive(once, update)).toBe(once);
  });

  /** A gap means something was missed: guessing would leave this browser wrong for good. */
  test("notices a missed update and asks to be brought up to date, changing nothing", () => {
    const room = welcomed();
    const skipped = {
      ...eventFor(room.state, { type: "repeat", mode: "all" }),
      v: 2,
    } as ServerMessage;

    const next = receive(room, skipped);

    expect(next.behind).toBe(true);
    expect(next.state).toBe(room.state);
  });

  test("a snapshot catches up and clears the flag", () => {
    const behind = { ...welcomed(), behind: true };
    const state = commit(emptyRoom(), [{ type: "repeat_set", mode: "all" }]);

    const next = receive(behind, { t: "snapshot", s: 2, room: snapshot(state), listeners: [] });

    expect(next.behind).toBe(false);
    expect(next.state.repeat).toBe("all");
    expect(next.you).toBe("ada");
  });

  test("keeps the feed to the latest fifty lines", () => {
    let room = welcomed();
    for (let index = 1; index <= 55; index += 1) {
      const update = eventFor(room.state, {
        type: "repeat",
        mode: index % 2 === 0 ? "off" : "all",
      });
      room = receive(room, {
        ...update,
        activity: { id: index, at: index, actorId: "ada", kind: "repeat_set", detail: {} },
      } as ServerMessage);
    }

    expect(room.activity).toHaveLength(50);
    expect(room.activity[0]?.id).toBe(6);
  });

  test("learns new people from the listener list", () => {
    const next = receive(welcomed(), {
      t: "listeners",
      listeners: [{ userId: "bob", listening: true, sync: "in_sync", errorCode: null }],
      people: [{ id: "bob", name: "Bob", avatarUrl: "x" }],
    });

    expect(next.people["bob"]?.name).toBe("Bob");
    expect(next.people["ada"]?.name).toBe("Ada");
    expect(next.listeners).toHaveLength(1);
  });
});
