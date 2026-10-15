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
export type { ActivityEntry } from "./domain/activity.ts";
export type { TrackInfo } from "./domain/TrackInfo.ts";
export { LinkRejected, type LinkRejectionCode } from "./domain/errors.ts";
export { RoomEngine, type RoomListener, type RoomUpdate } from "./application/RoomEngine.ts";
export { RestoreRoom } from "./application/RestoreRoom.ts";
export { AddFromLink, type AddReport } from "./application/AddFromLink.ts";
export { ControlRoom, type PersonCommand } from "./application/ControlRoom.ts";
export { PauseEmptyRoom } from "./application/PauseEmptyRoom.ts";
export { MaintainQueue } from "./application/MaintainQueue.ts";
export { GetRoomView, type RoomView } from "./application/GetRoomView.ts";
export { DescribePeople } from "./application/DescribePeople.ts";
export { RoomSockets, type RoomSocketData } from "./http/RoomSockets.ts";
export { createRoomSocketRoute } from "./http/socketRoute.ts";
export { IdentityPeopleDirectory } from "./infrastructure/IdentityPeopleDirectory.ts";
export { SqliteRoomRepository } from "./infrastructure/persistence/SqliteRoomRepository.ts";
export { SqliteActivityRepository } from "./infrastructure/persistence/SqliteActivityRepository.ts";
export { CatalogTrackSource, type CatalogUseCases } from "./infrastructure/CatalogTrackSource.ts";
export { MathRandom } from "./infrastructure/MathRandom.ts";
