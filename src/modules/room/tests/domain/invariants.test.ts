import { describe, expect, test } from "bun:test";
import type { RoomCommand } from "@/modules/room/domain/commands.ts";
import { decide } from "@/modules/room/domain/decide.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { endsAt } from "@/modules/room/domain/playback.ts";
import { ownerOfCurrent } from "@/modules/room/domain/rotation.ts";
import { emptyRoom, queuedCount, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { upcoming } from "@/modules/room/domain/upcoming.ts";
import { NOW, SeededRandom, songs } from "@/modules/room/tests/support/room.ts";
import { upcomingByEvolve } from "@/modules/room/tests/support/upcomingByEvolve.ts";

/**
 * Random command sequences against the rules that must hold after every one.
 * Seeded, so a failure names a scenario that can be replayed exactly.
 */
const OWNERS = ["ada", "bob", "cy", "dee"];
const SCENARIOS = 300;
const STEPS = 150;
/** The reference is slow; checking it on every step of the first scenarios is plenty. */
const REFERENCE_SCENARIOS = 60;

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
  const queued = Object.values(state.lanes).flat();
  const anyEntry = [...queued, state.current?.entryId ?? "gone"];
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
  if (roll < 75) {
    return {
      command: { type: "shuffle", ownerId: random.int(3) === 0 ? null : pick(random, OWNERS) },
      now,
    };
  }
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
  // A command aimed at something that never existed.
  return { command: { type: "skip", entryId: `stale-${now}` }, now };
}

/** The structural rules: every entry in exactly one place, every place-in-line justified. */
function structuralViolations(state: RoomState): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const current = state.current?.entryId;
  if (current !== undefined) seen.add(current);

  for (const [ownerId, lane] of Object.entries(state.lanes)) {
    if (lane.length === 0) problems.push(`${ownerId} has an empty lane`);
    for (const entryId of lane) {
      if (seen.has(entryId)) problems.push(`${entryId} appears twice`);
      seen.add(entryId);
      if (state.entries[entryId]?.ownerId !== ownerId)
        problems.push(`${entryId} is in the wrong lane`);
    }
  }

  const entryIds = Object.keys(state.entries).sort();
  if (JSON.stringify(entryIds) !== JSON.stringify([...seen].sort())) {
    problems.push("entries and lanes+current disagree");
  }

  const playing = ownerOfCurrent(state);
  for (const ownerId of Object.keys(state.lanes)) {
    const waiting = state.keys[ownerId] !== undefined;
    if (ownerId === playing && waiting) problems.push(`${ownerId} is in line while playing`);
    if (ownerId !== playing && !waiting) problems.push(`${ownerId} has songs but no place in line`);
  }
  for (const ownerId of Object.keys(state.keys)) {
    if (state.lanes[ownerId] === undefined)
      problems.push(`${ownerId} is in line with nothing queued`);
  }

  const keys = Object.values(state.keys);
  if (new Set(keys).size !== keys.length) problems.push("two people share a place in line");
  if (keys.some((key) => key > state.counter)) problems.push("a key is ahead of the counter");

  return problems;
}

describe("room invariants under random commands", () => {
  test(`hold after every step of ${SCENARIOS} scenarios × ${STEPS} commands`, () => {
    const failures: string[] = [];

    for (let seed = 1; seed <= SCENARIOS && failures.length === 0; seed += 1) {
      const random = new SeededRandom(seed);
      let state = emptyRoom();
      let now = NOW;
      /** Per owner, the step at which their last turn began. */
      const lastTurn = new Map<string, number>();
      /** Per step, who was waiting in line. */
      const waitingAt: Set<string>[] = [];
      const turnsAt: (string | null)[] = [];
      /** "Up next" for the current state, carried forward so each step computes it once. */
      let order: string[] = [];

      for (let step = 0; step < STEPS && failures.length === 0; step += 1) {
        const generated = randomCommand(state, random, now);
        now = Math.max(now, generated.now) + random.int(5000);
        const before = state;
        const predictedNext = order[0];

        const decision = decide(before, generated.command, { now, random });
        if (decision.kind === "rejected") {
          // A refusal changes nothing: there is no state to compare, only the claim.
          turnsAt.push(null);
          waitingAt.push(new Set(Object.keys(before.keys)));
          continue;
        }

        state = commit(before, decision.events);
        const where = `seed ${seed}, step ${step}, ${generated.command.type}`;

        for (const problem of structuralViolations(state)) failures.push(`${where}: ${problem}`);

        const expectedVersion = before.version + (decision.events.length > 0 ? 1 : 0);
        if (state.version !== expectedVersion) failures.push(`${where}: version ${state.version}`);
        if (state.counter < before.counter) failures.push(`${where}: counter went backwards`);

        order = upcoming(state);
        if (order.length !== queuedCount(state) || new Set(order).size !== order.length) {
          failures.push(`${where}: upcoming is not each queued entry once`);
        }
        // The fast simulation must say exactly what folding real events says.
        if (seed <= REFERENCE_SCENARIOS) {
          const reference = upcomingByEvolve(state);
          if (JSON.stringify(order) !== JSON.stringify(reference)) {
            failures.push(`${where}: upcoming disagrees with evolve`);
          }
        }

        // A skip must land exactly where "up next" said it would.
        if (generated.command.type === "skip" && predictedNext !== undefined) {
          if (state.current?.entryId !== predictedNext)
            failures.push(`${where}: skip broke upcoming[0]`);
        }

        // A turn is a song starting fresh — not repeat-one replaying the same one.
        const advanced = decision.events.find((event) => event.type === "advanced");
        const replayed =
          advanced?.type === "advanced" &&
          advanced.reason === "ended" &&
          before.repeat === "one" &&
          before.current?.entryId === state.current?.entryId;
        const turnTaker = advanced !== undefined && !replayed ? ownerOfCurrent(state) : null;
        turnsAt.push(turnTaker);
        waitingAt.push(new Set(Object.keys(state.keys)));

        if (turnTaker !== null) {
          const previous = lastTurn.get(turnTaker);
          if (previous !== undefined) {
            for (const other of OWNERS) {
              if (other === turnTaker) continue;
              const waitedThroughout = waitingAt
                .slice(previous, step)
                .every((set) => set.has(other));
              const hadTurn = turnsAt.slice(previous + 1, step).includes(other);
              if (waitedThroughout && !hadTurn) {
                failures.push(`${where}: ${turnTaker} played twice while ${other} waited`);
              }
            }
          }
          lastTurn.set(turnTaker, step);
        }
      }
    }

    expect(failures.slice(0, 5)).toEqual([]);
  });

  /** The checker must be able to fail, or a green run means nothing. */
  test("the structural check catches a broken room", () => {
    const broken: RoomState = {
      ...emptyRoom(),
      entries: { e1: { id: "e1", ownerId: "ada", trackId: "t", durationMs: 1, addedAt: 0 } },
      lanes: { ada: ["e1", "e1"], bob: [] },
      keys: { carl: 5 },
      counter: 1,
    };

    expect(structuralViolations(broken).length).toBeGreaterThan(3);
  });
});
