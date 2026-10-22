/**
 * Browser surface of the player module. Shape: FLAT — it makes this one
 * device follow a timeline the room decides; it owns no data and no rules
 * anyone else must obey, so there is nothing for a domain layer to hold.
 * `reconcile` and `ClockSync` are pure and tested without a browser.
 */
export { ClockSync } from "./ClockSync.ts";
export {
  reconcile,
  type PlayerAction,
  type PlayerView,
  type SyncStatus,
  type Target,
} from "./reconcile.ts";
export type { PlayerAdapter, PlayerEvents, PlayerState } from "./PlayerAdapter.ts";
export { SyncedPlayer } from "./SyncedPlayer.ts";
export { useSyncedPlayer, type SyncedPlayerState } from "./useSyncedPlayer.ts";
export { useMediaKeys } from "./useMediaKeys.ts";
export { PlayerTile } from "./PlayerTile.tsx";
export { VolumeControl } from "./VolumeControl.tsx";
export {
  INITIAL_AUDIO,
  readAudioPreferences,
  writeAudioPreferences,
  type AudioPreferences,
} from "./localAudio.ts";
