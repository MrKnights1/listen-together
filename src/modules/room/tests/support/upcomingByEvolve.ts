/**
 * The reference for `upcoming`: the same answer computed slowly but
 * unarguably, by folding real `advanced` events through `evolve`. Tests hold
 * the fast version to it.
 */
import { evolve } from "@/modules/room/domain/evolve.ts";
import type { RoomState } from "@/modules/room/domain/RoomState.ts";

/**
 * Every queued entry once, in the order each will next play — found by
 * running the rotation forward on a copy. Simulated rather than sorted, so the
 * list can never disagree with what actually happens.
 *
 * Under repeat-all a short list comes round again before a long one is done,
 * so the true sequence of plays repeats songs; the list shows each song at its
 * *first* coming play, which is what a person scanning "up next" wants to know.
 * Repeat-one is treated as a skip: "up next" means after this song.
 */
export function upcomingByEvolve(state: RoomState): string[] {
  const queued = new Set(Object.values(state.lanes).flat());
  const order: string[] = [];
  if (queued.size === 0) return order;

  // Each round of the rotation plays one song per person waiting, so the last
  // entry of the longest list comes up within (people + 1) × queued steps.
  const people = Object.keys(state.lanes).length + 1;
  let room = state;

  for (let step = queued.size * (people + 1); step > 0 && order.length < queued.size; step -= 1) {
    room = evolve(room, { type: "advanced", reason: "skipped", at: 0 });
    if (room.current === null) break;

    const entryId = room.current.entryId;
    if (queued.has(entryId) && !order.includes(entryId)) order.push(entryId);
  }

  return order;
}
