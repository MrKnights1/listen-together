/** One person's queue. Long enough for any real playlist session, short enough to scroll. */
export const MAX_LANE_ENTRIES = 300;

/** The whole room. Bounds memory, the snapshot sent to every browser, and the daily cache refresh. */
export const MAX_ROOM_ENTRIES = 1000;

/**
 * The end-of-song alarm fires this long after the computed end. YouTube
 * reports durations in whole seconds, so the true end can be up to a second
 * later than the number says; cutting a song short is worse than a beat of
 * silence.
 */
export const TRACK_END_GRACE_MS = 1000;

/** How long a room with nobody listening keeps playing before pausing itself. */
export const EMPTY_ROOM_PAUSE_MS = 60_000;

/**
 * A restart this soon after a clean shutdown is a deploy: the room carries on
 * on its original timing, as if nothing happened. Anything else — a crash, or
 * a long outage — comes back paused, so nobody returns to a song half over.
 */
export const RESUME_WINDOW_MS = 30_000;
