import { describe, expect, test } from "bun:test";
import type { RoomCommand } from "@/modules/room/domain/commands.ts";
import { decide } from "@/modules/room/domain/decide.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { endsAt } from "@/modules/room/domain/playback.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { NOW, SeededRandom, songs } from "@/modules/room/tests/support/room.ts";

/**
 * Random command sequences against the rules that must hold after every one.
 * Seeded, so a failure names a scenario that can be replayed exactly.
 */
const OWNERS = ["ada", "bob", "cy", "dee"];
const SCENARIOS = 300;
const STEPS = 150;

function pick<T>(random: SeededRandom, items: readonly T[]): T {
  const item = items[random.int(items.length)];
  if (item === undefined) throw new Error("picked from an empty list");
  return item;
}

function randomCommand(
  state: RoomState,
  random: SeededRandom,
  now: number,
): { command: RoomCommand; now: number } {
  const anyEntry = [...state.queue, state.current?.entryId ?? "gone"];
  const roll = random.int(100);

  if (roll < 30) {
    const ownerId = pick(random, OWNERS);
    const fresh = songs(ownerId, 1 + random.int(4), 1000 * (30 + random.int(300)));
    // Sometimes re-add a song already in the room, to exercise duplicates.
    const existing = Object.values(state.entries);
    const repeat = existing.length > 0 && random.int(4) === 0 ? [pick(random, existing)] : [];
    return {
      command: {
        type: "add",
        ownerId,
        tracks: [
          ...fresh,
          ...repeat.map((entry) => ({
            entryId: `dup-${now}-${entry.id}`,
            trackId: entry.trackId,
            durationMs: entry.durationMs,
          })),
        ],
      },
      now,
    };
  }
  if (roll < 45) {
    const ending = endsAt(state);
    const at = ending === null ? now : ending + 1000;
    return { command: { type: "track_ended", entryId: state.current?.entryId ?? "gone" }, now: at };
  }
  if (roll < 55)
    return { command: { type: "skip", entryId: state.current?.entryId ?? "gone" }, now };
  if (roll < 63) return { command: { type: "remove", entryId: pick(random, anyEntry) }, now };
  if (roll < 70) {
    return {
      command: { type: "move", entryId: pick(random, anyEntry), toIndex: random.int(8) - 2 },
      now,
    };
  }
  if (roll < 73) return { command: { type: "shuffle", ownerId: pick(random, OWNERS) }, now };
  if (roll < 75) return { command: { type: "set_shuffle", on: random.int(2) === 0 }, now };
  if (roll < 80)
    return { command: { type: "repeat", mode: pick(random, ["off", "one", "all"] as const) }, now };
  if (roll < 87) {
    const type = pick(random, ["pause", "resume"] as const);
    return { command: { type, entryId: state.current?.entryId ?? "gone" }, now };
  }
  if (roll < 92) {
    return {
      command: {
        type: "seek",
        entryId: state.current?.entryId ?? "gone",
        positionMs: random.int(400_000),
      },
      now,
    };
  }
  if (roll < 95) return { command: { type: "auto_pause" }, now };
  if (roll < 97) {
    // Everything, or only what was added up to some song: as if more arrived while deciding.
    const queued = state.queue.flatMap((entryId) => state.entries[entryId] ?? []);
    const addedUpTo = queued.length > 0 && random.int(2) === 0 ? pick(random, queued).addedAt : now;
    return { command: { type: "clear", addedUpTo }, now };
  }
  // A command aimed at something that never existed.
  return { command: { type: "skip", entryId: `stale-${now}` }, now };
}

/** The structural rules: every entry in exactly one place, and nothing queued that does not exist. */
function structuralViolations(state: RoomState): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const current = state.current?.entryId;
  if (current !== undefined) seen.add(current);

  for (const entryId of state.queue) {
    if (seen.has(entryId)) problems.push(`${entryId} appears twice`);
    seen.add(entryId);
    if (state.entries[entryId] === undefined) problems.push(`${entryId} is queued but missing`);
  }

  const entryIds = Object.keys(state.entries).sort();
  if (JSON.stringify(entryIds) !== JSON.stringify([...seen].sort())) {
    problems.push("entries and queue+current disagree");
  }

  return problems;
}

/**
 * First come, first played: songs that stay queued keep their order, and a
 * song new to the queue never lands ahead of one already in it. Only a move or
 * a shuffle may reorder.
 */
function orderViolations(before: RoomState, after: RoomState): string[] {
  const wasQueued = new Set(before.queue);
  const isQueued = new Set(after.queue);
  const kept = after.queue.filter((entryId) => wasQueued.has(entryId));
  const expected = before.queue.filter((entryId) => isQueued.has(entryId));

  const problems: string[] = [];
  if (JSON.stringify(kept) !== JSON.stringify(expected))
    problems.push("queued songs changed order");
  const firstNew = after.queue.findIndex((entryId) => !wasQueued.has(entryId));
  if (firstNew !== -1 && after.queue.slice(firstNew).some((entryId) => wasQueued.has(entryId))) {
    problems.push("a new song went ahead of one already queued");
  }
  return problems;
}

describe("room invariants under random commands", () => {
  test(`hold after every step of ${SCENARIOS} scenarios × ${STEPS} commands`, () => {
    const failures: string[] = [];

    for (let seed = 1; seed <= SCENARIOS && failures.length === 0; seed += 1) {
      const random = new SeededRandom(seed);
      let state = emptyRoom();
      let now = NOW;

      for (let step = 0; step < STEPS && failures.length === 0; step += 1) {
        const generated = randomCommand(state, random, now);
        now = Math.max(now, generated.now) + random.int(5000);
        const before = state;

        const decision = decide(before, generated.command, { now, random });
        // A refusal changes nothing: there is no state to compare, only the claim.
        if (decision.kind === "rejected") continue;

        state = commit(before, decision.events);
        const where = `seed ${seed}, step ${step}, ${generated.command.type}`;

        for (const problem of structuralViolations(state)) failures.push(`${where}: ${problem}`);

        const expectedVersion = before.version + (decision.events.length > 0 ? 1 : 0);
        if (state.version !== expectedVersion) failures.push(`${where}: version ${state.version}`);

        if (generated.command.type === "clear") {
          const { addedUpTo } = generated.command;
          if (JSON.stringify(state.current) !== JSON.stringify(before.current)) {
            failures.push(`${where}: clearing changed the song playing`);
          }
          const left = state.queue.filter(
            (entryId) => (state.entries[entryId]?.addedAt ?? Infinity) <= addedUpTo,
          );
          if (left.length > 0) failures.push(`${where}: clearing left ${left.length} songs`);
        }

        const reorders = generated.command.type === "move" || generated.command.type === "shuffle";
        if (!reorders) {
          for (const problem of orderViolations(before, state))
            failures.push(`${where}: ${problem}`);
        }

        // Moving on — a skip, or a song ending without repeat-one — plays the head of the
        // queue, or with shuffle on any song that was waiting, never the one that just played.
        const movesOn =
          decision.events.some((event) => event.type === "advanced") &&
          !(generated.command.type === "track_ended" && before.repeat === "one");
        const head = before.queue[0];
        if (movesOn && generated.command.type !== "add" && head !== undefined) {
          const playing = state.current?.entryId ?? "none";
          const next = before.shuffle ? before.queue.includes(playing) : playing === head;
          if (!next) failures.push(`${where}: did not play a waiting song`);
        }
      }
    }

    expect(failures.slice(0, 5)).toEqual([]);
  });

  /** The checkers must be able to fail, or a green run means nothing. */
  test("the structural check catches a broken room", () => {
    const broken: RoomState = {
      ...emptyRoom(),
      entries: { e1: { id: "e1", ownerId: "ada", trackId: "t", durationMs: 1, addedAt: 0 } },
      queue: ["e1", "e1", "ghost"],
    };

    expect(structuralViolations(broken).length).toBeGreaterThanOrEqual(3);
  });

  test("the order check catches a song that jumped the queue", () => {
    const before: RoomState = { ...emptyRoom(), queue: ["a", "b"] };

    expect(orderViolations(before, { ...before, queue: ["b", "a"] })).not.toEqual([]);
    expect(orderViolations(before, { ...before, queue: ["new", "a", "b"] })).not.toEqual([]);
    expect(orderViolations(before, { ...before, queue: ["a", "b", "new"] })).toEqual([]);
  });
});
