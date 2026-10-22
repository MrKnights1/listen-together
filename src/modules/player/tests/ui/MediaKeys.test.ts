import { beforeEach, describe, expect, test } from "bun:test";
import {
  MediaKeys,
  type MediaKeysView,
  type NowPlayingInfo,
} from "@/modules/player/ui/MediaKeys.ts";
import { FakeLoop, FakeMediaSession } from "@/modules/player/tests/support/fakes.ts";

const SONG: NowPlayingInfo = {
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
};

/** A listener hearing the room's song play; each test changes what it is about. */
const LISTENING_TO_PLAY: MediaKeysView = {
  listening: true,
  playback: "playing",
  songPlaying: true,
  nowPlaying: SONG,
};
/** The room paused, and this listener's player has paused with it. */
const PAUSED: MediaKeysView = { ...LISTENING_TO_PLAY, playback: "paused", songPlaying: false };
const IDLE: MediaKeysView = { ...PAUSED, playback: "idle", nowPlaying: null };
const NOT_LISTENING: MediaKeysView = { ...LISTENING_TO_PLAY, listening: false, songPlaying: false };

let session: FakeMediaSession;
let loops: FakeLoop[];
let refusal: Error | null;
let pressed: string[];
let keys: MediaKeys;

beforeEach(() => {
  session = new FakeMediaSession();
  loops = [];
  refusal = null;
  pressed = [];
  keys = new MediaKeys({
    session,
    createLoop: () => {
      const loop = new FakeLoop(refusal);
      loops.push(loop);
      return loop;
    },
    onPlay: () => pressed.push("resume"),
    onPause: () => pressed.push("pause"),
    onNext: () => pressed.push("skip"),
  });
});

/** Lets a loop's play() promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Collects console.error calls made while `run` and its promises settle. */
async function errorsDuring(run: () => void): Promise<unknown[][]> {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    run();
    await settle();
  } finally {
    console.error = original;
  }
  return errors;
}

describe("MediaKeys", () => {
  test("takes no keys and plays nothing until the listener starts listening", () => {
    keys.update(NOT_LISTENING);

    expect(session.handlers.size).toBe(0);
    expect(loops).toEqual([]);
    expect(session.metadata).toBeNull();
  });

  test("while listening to a playing room, plays the loop and shows the song as playing", () => {
    keys.update(LISTENING_TO_PLAY);

    expect([...session.handlers.keys()]).toEqual(["play", "pause", "nexttrack"]);
    expect(loops[0]?.playing).toBe(true);
    expect(session.metadata).toEqual(SONG);
    expect(session.playbackState).toBe("playing");
  });

  test("shows the room as paused at once, but pauses the loop only after the song's player has", () => {
    keys.update(LISTENING_TO_PLAY);
    keys.update({ ...LISTENING_TO_PLAY, playback: "paused" });

    expect(session.playbackState).toBe("paused");
    expect(loops[0]?.playing).toBe(true);

    keys.update(PAUSED);

    expect(loops[0]?.playing).toBe(false);
  });

  test("plays the same loop again when the room resumes", () => {
    keys.update(LISTENING_TO_PLAY);
    keys.update(PAUSED);
    keys.update(LISTENING_TO_PLAY);

    expect(loops).toHaveLength(1);
    expect(loops[0]?.playing).toBe(true);
    expect(loops[0]?.plays).toBe(2);
  });

  test("listening into a paused room plays the loop once, then rests it, so the keys reach the page", async () => {
    keys.update(PAUSED);
    await settle();

    expect(loops[0]?.plays).toBe(1);
    expect(loops[0]?.playing).toBe(false);
    expect(session.playbackState).toBe("paused");
  });

  test("a loop primed into a paused room plays on if the room resumes meanwhile", async () => {
    keys.update(PAUSED);
    keys.update(LISTENING_TO_PLAY);
    await settle();

    expect(loops[0]?.playing).toBe(true);
  });

  test("pause pauses a playing room, and play resumes a paused one", () => {
    keys.update(LISTENING_TO_PLAY);
    session.press("pause");
    keys.update(PAUSED);
    session.press("play");

    expect(pressed).toEqual(["pause", "resume"]);
  });

  test("a key that would change nothing sends nothing", () => {
    keys.update(PAUSED);
    session.press("pause");
    keys.update(LISTENING_TO_PLAY);
    session.press("play");

    expect(pressed).toEqual([]);
  });

  test("next skips the song the room is on", () => {
    keys.update(PAUSED);
    session.press("nexttrack");

    expect(pressed).toEqual(["skip"]);
  });

  test("with nothing playing, shows nothing, rests the loop and no key does anything", async () => {
    keys.update(IDLE);
    await settle();
    session.press("play");
    session.press("pause");
    session.press("nexttrack");

    expect(pressed).toEqual([]);
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
    expect(loops[0]?.playing).toBe(false);
  });

  test("shows a new song, and does not set the same one again on every update", () => {
    const next = { title: "Take On Me", artist: "a-ha", artworkUrl: null };
    keys.update(LISTENING_TO_PLAY);
    keys.update({ ...LISTENING_TO_PLAY, nowPlaying: { ...SONG } });
    keys.update({ ...LISTENING_TO_PLAY, nowPlaying: next });

    expect(session.metadata).toEqual(next);
    expect(session.metadataSets).toBe(2);
  });

  test("stopping listening gives the keys back and ends the loop", () => {
    keys.update(LISTENING_TO_PLAY);
    keys.update(NOT_LISTENING);
    session.press("pause");

    expect(session.handlers.size).toBe(0);
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe("none");
    expect(loops[0]?.destroyed).toBe(true);
    expect(pressed).toEqual([]);
  });

  test("listening again starts a fresh loop and takes the keys again", () => {
    keys.update(LISTENING_TO_PLAY);
    keys.update(NOT_LISTENING);
    keys.update(LISTENING_TO_PLAY);

    expect(loops).toHaveLength(2);
    expect(loops[1]?.playing).toBe(true);
    expect(session.metadata).toEqual(SONG);
    expect(session.handlers.size).toBe(3);
  });

  test("destroy gives the keys back", () => {
    keys.update(LISTENING_TO_PLAY);
    keys.destroy();

    expect(session.handlers.size).toBe(0);
    expect(loops[0]?.destroyed).toBe(true);
  });

  test("a loop the browser refuses to play is reported, not thrown", async () => {
    refusal = new DOMException("Blocked by the content security policy", "NotSupportedError");

    const errors = await errorsDuring(() => keys.update(LISTENING_TO_PLAY));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.[1]).toBe(refusal);
    expect(session.handlers.size).toBe(3);
  });

  test("a play cut short by a pause is not reported", async () => {
    refusal = new DOMException("The play() request was interrupted", "AbortError");

    const errors = await errorsDuring(() => keys.update(LISTENING_TO_PLAY));

    expect(errors).toEqual([]);
  });
});
