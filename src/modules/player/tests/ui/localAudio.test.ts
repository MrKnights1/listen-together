import { describe, expect, test } from "bun:test";
import {
  INITIAL_AUDIO,
  readAudioPreferences,
  writeAudioPreferences,
} from "@/modules/player/ui/localAudio.ts";

/** Browser storage is the boundary; a Map stands in for it. */
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("audio preferences", () => {
  test("start at the initial volume before anything was saved", () => {
    expect(readAudioPreferences(storage())).toEqual(INITIAL_AUDIO);
  });

  test("come back as they were saved", () => {
    const store = storage();
    writeAudioPreferences(store, { volume: 35, muted: true });

    expect(readAudioPreferences(store)).toEqual({ volume: 35, muted: true });
  });

  test.each([
    ["not JSON", "{oops"],
    ["a volume over 100", JSON.stringify({ volume: 101, muted: false })],
    ["a fractional volume", JSON.stringify({ volume: 33.3, muted: false })],
    ["a string for muted", JSON.stringify({ volume: 50, muted: "no" })],
    ["null", "null"],
  ])("fall back to the initial volume for %s", (_name, raw) => {
    expect(readAudioPreferences(storage({ "musicplayer.audio": raw }))).toEqual(INITIAL_AUDIO);
  });

  test("survive a browser that refuses storage", () => {
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };

    expect(readAudioPreferences(refusing)).toEqual(INITIAL_AUDIO);
    expect(() => writeAudioPreferences(refusing, { volume: 10, muted: false })).not.toThrow();
  });
});
