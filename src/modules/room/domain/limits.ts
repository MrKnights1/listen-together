/**
 * The whole room, and so the most one pasted playlist may add: as many as a
 * YouTube playlist holds, though a channel's uploads can run longer. Bounds
 * memory, the daily cache refresh, and the snapshot sent to every browser —
 * a socket with 16 MB unsent is dropped; a full room is about 1.1 MB.
 */
export const MAX_ROOM_ENTRIES = 5000;

/**
 * The end-of-song alarm fires this long after the computed end. YouTube
 * reports durations in whole seconds, so the true end can be up to a second
 * later than the number says; cutting a song short is worse than a beat of
 * silence.
 */
export const TRACK_END_GRACE_MS = 1000;

/** How many songs Recently played remembers. */
export const RECENTLY_PLAYED = 25;

/** A song skipped sooner than this was not heard, and is not remembered as played. */
export const MIN_PLAYED_MS = 30_000;

/** How long a room with nobody listening keeps playing before pausing itself. */
export const EMPTY_ROOM_PAUSE_MS = 60_000;

/**
 * A restart this soon after a clean shutdown is a deploy: the room carries on
 * on its original timing, as if nothing happened. Anything else — a crash, or
 * a long outage — comes back paused, so nobody returns to a song half over.
 */
export const RESUME_WINDOW_MS = 30_000;
