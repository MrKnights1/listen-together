/**
 * Public surface of the room module. Shape: LAYERED — fair rotation, the
 * shared playback clock and repeat/shuffle are rules that can be violated,
 * and are tested as pure functions without a database, a socket or a clock.
 */
export { decide, type AddOutcome, type Decision, type RejectionCode } from "./domain/decide.ts";
export { commit, evolve } from "./domain/evolve.ts";
export { endsAt, positionAt } from "./domain/playback.ts";
export { upcoming } from "./domain/upcoming.ts";
export { emptyRoom, type QueueEntry, type RoomState } from "./domain/RoomState.ts";
export type { RoomCommand } from "./domain/commands.ts";
export type { RoomEvent } from "./domain/events.ts";
