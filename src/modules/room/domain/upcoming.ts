import type { RoomState } from "./RoomState.ts";

/**
 * Every queued entry once, in the order each will next play.
 *
 * Found by running the rotation forward — the same rules `evolve` applies on
 * a skip: the outgoing song goes back on its owner's list under repeat-all,
 * its owner rejoins the line at the back, and the lowest key plays next. It
 * runs on scratch copies of just the lists and the line rather than through
 * `evolve`, because browsers recompute it after every change and a full room
 * would otherwise copy a thousand entries per simulated song. The tests hold
 * it to exactly what `evolve` does.
 *
 * Under repeat-all a short list comes round again before a long one is done,
 * so the true sequence of plays repeats songs; each song is listed at its
 * *first* coming play. Repeat-one is treated as a skip: "up next" means after
 * this song.
 */
export function upcoming(state: RoomState): string[] {
  const lanes = new Map(Object.entries(state.lanes).map(([ownerId, lane]) => [ownerId, [...lane]]));
  const keys = new Map(Object.entries(state.keys));
  const queued = new Set([...lanes.values()].flat());
  const order: string[] = [];
  const listed = new Set<string>();
  let counter = state.counter;
  let current = state.current?.entryId ?? null;

  const ownerOf = (entryId: string): string => {
    const ownerId = state.entries[entryId]?.ownerId;
    if (ownerId === undefined) throw new Error(`Entry ${entryId} is missing.`);
    return ownerId;
  };

  // Each round plays one song per person waiting, so the last entry of the
  // longest list comes up within (people + 1) × queued steps.
  const people = lanes.size + 1;
  for (let step = queued.size * (people + 1); step > 0 && order.length < queued.size; step -= 1) {
    if (current !== null) {
      const ownerId = ownerOf(current);
      if (state.repeat === "all") lanes.set(ownerId, [...(lanes.get(ownerId) ?? []), current]);
      if ((lanes.get(ownerId)?.length ?? 0) > 0 && !keys.has(ownerId)) {
        counter += 1;
        keys.set(ownerId, counter);
      }
    }

    let next: string | null = null;
    let lowest = Infinity;
    for (const [ownerId, key] of keys) {
      if (key < lowest) {
        next = ownerId;
        lowest = key;
      }
    }
    if (next === null) break;

    const lane = lanes.get(next) ?? [];
    current = lane.shift() ?? null;
    keys.delete(next);
    if (lane.length === 0) lanes.delete(next);
    if (current === null) break;

    if (queued.has(current) && !listed.has(current)) {
      listed.add(current);
      order.push(current);
    }
  }

  return order;
}
