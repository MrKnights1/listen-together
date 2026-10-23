import type { AddResult, NackCode, SyncStatus } from "@/modules/room/contract/messages.ts";
import type { ActivityEntry } from "@/modules/room/domain/activity.ts";

/** What went wrong with a command, said so that it can be acted on. */
export function refusal(code: NackCode | "disconnected"): string {
  switch (code) {
    case "stale":
      return "The room moved on before that arrived. Try again.";
    case "rate_limited":
      return "That was a lot at once. Wait a few seconds and try again.";
    case "busy":
      return "Your last link is still being added.";
    case "invalid_url":
      return "That isn't a link. Paste a YouTube video or playlist address.";
    case "unsupported_url":
      return "Only YouTube video and playlist links can be added.";
    case "playlist_not_found":
      return "That playlist doesn't exist or isn't public.";
    case "song_not_in_playlist":
      return "That song isn't in that playlist any more. Paste the playlist's own link to add it.";
    case "provider_unavailable":
      return "YouTube isn't answering right now. Try again in a minute.";
    case "invalid":
      return "The room didn't understand that.";
    case "unavailable":
      return "The room couldn't do that just now. Try again.";
    case "disconnected":
      return "Lost the connection to the room. Reconnecting…";
  }
}

const SKIP_REASONS: Record<string, string> = {
  not_found: "unavailable",
  private: "private",
  not_processed: "still processing",
  live: "a live stream",
  age_restricted: "age-restricted",
  not_embeddable: "not allowed outside YouTube",
  region_blocked: "blocked in this region",
  no_duration: "has no length",
};

/** 1 song, 12 songs. Also how many songs wait in Up next, beside its heading. */
export const songs = (count: number) => `${count} ${count === 1 ? "song" : "songs"}`;

/** A time of day in the listener's own way of writing it: "20:14", or "08:14 PM". */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** What adding a link did, in one or two sentences. */
export function addSummary(result: AddResult): string {
  const parts: string[] = [];
  parts.push(
    result.added === 0 ? "Nothing new was added." : `Added ${songs(result.added)} to your list.`,
  );
  if (result.duplicates > 0) parts.push(`${songs(result.duplicates)} already queued.`);
  if (result.overflow > 0) parts.push(`${songs(result.overflow)} left out: the room is full.`);
  if (result.truncated) parts.push("The room is full, so the rest of the playlist was left out.");
  if (result.skipped.length === 1) {
    const [only] = result.skipped;
    parts.push(
      `Skipped ${only?.title ?? "one video"}: ${SKIP_REASONS[only?.reason ?? ""] ?? "can't be played"}.`,
    );
  } else if (result.skipped.length > 1) {
    parts.push(`${songs(result.skipped.length)} skipped because they can't be played here.`);
  }
  return parts.join(" ");
}

/** What clearing the queue will do, asked before it is done. */
export function clearQuestion(count: number): string {
  const what = count === 1 ? "1 song" : `all ${songs(count)}`;
  return `This removes ${what} from Up next for everyone. The song playing now keeps playing.`;
}

/** Shown beside Start listening once the browser has refused to start the sound. */
export const AUTOPLAY_BLOCKED =
  "Your browser stopped the sound from starting. Press Start listening again. If it keeps happening, allow this site to play sound in your browser's settings.";

/** Why a listener's player refused the song, and what might help. */
export interface PlayerProblem {
  /** Said about the listener, so it reads right beside anyone's name; null when YouTube gave no reason. */
  what: string | null;
  /** Said to the listener whose player it is. */
  help: string;
  /** Whether loading the song again can work. */
  retry: boolean;
}

const WONT_HELP = "Trying again won't help. If nobody can hear it, skip it.";

/** YouTube's IFrame player error codes, in plain words. */
export function playerProblem(errorCode: number | null): PlayerProblem {
  switch (errorCode) {
    case 2:
      return { what: "its YouTube link is broken", help: WONT_HELP, retry: false };
    case 5:
      return {
        what: "YouTube's player failed on this device",
        help: "Try again. If it keeps failing, reload the page.",
        retry: true,
      };
    case 100:
      return { what: "it was removed from YouTube or made private", help: WONT_HELP, retry: false };
    case 101:
    case 150:
      return {
        what: "YouTube won't play it here",
        help: `Its uploader allows it only on YouTube, or it is blocked where you are. ${WONT_HELP}`,
        retry: false,
      };
    case 153:
      return {
        what: "the browser hid this site from YouTube",
        help: "A privacy setting or extension stops YouTube seeing which site asks. Allow this site, then try again.",
        retry: true,
      };
    default:
      return {
        what: null,
        help: "Try again. If it keeps failing, skip it.",
        retry: true,
      };
  }
}

/** A listener's line in "Listening now". */
export function presenceLine(
  listening: boolean,
  sync: SyncStatus,
  errorCode: number | null,
): string {
  if (!listening) return "Here, not listening";
  switch (sync) {
    case "in_sync":
      return "In sync";
    case "catching_up":
      return "Catching up";
    case "out_of_sync":
      return "Out of sync";
    case "error": {
      const { what } = playerProblem(errorCode);
      return what === null ? "Can't play this song" : `Can't play this song: ${what}`;
    }
    case "no_player":
      return "YouTube's player didn't load";
    case "idle":
      return "Listening";
  }
}

/** One line of the activity feed, without the person's name, which is shown beside it. */
export function activityLine(entry: ActivityEntry): string {
  const title = entry.detail.title ?? "a song";
  switch (entry.kind) {
    case "added":
      return `added ${songs(entry.detail.count ?? 0)}`;
    case "skipped":
      return `skipped ${title}`;
    case "removed":
      return `removed ${title}`;
    case "auto_removed":
      return `${title} was removed: YouTube no longer plays it`;
    case "paused":
      return "paused the room";
    case "auto_paused":
      return "The room paused itself because nobody was listening";
    case "resumed":
      return "resumed the room";
    case "seeked":
      return `jumped to ${formatDuration(entry.detail.positionMs ?? 0)}`;
    case "moved":
      return `moved ${title}`;
    case "cleared":
      return `cleared ${songs(entry.detail.count ?? 0)} from the queue`;
    case "shuffled":
      return entry.detail.ownerId === null ? "shuffled the queue" : "shuffled their songs";
    case "repeat_set":
      return entry.detail.mode === "off"
        ? "turned repeat off"
        : entry.detail.mode === "one"
          ? "set repeat to this song"
          : "set repeat to the whole queue";
    case "shuffle_set":
      return entry.detail.on === true ? "turned shuffle on" : "turned shuffle off";
    case "star_set":
      return entry.detail.on === true ? `starred ${title} to play next` : `unstarred ${title}`;
  }
}

/** 3:05, or 1:02:03 past an hour. Tabular numerals keep it from jittering. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}
