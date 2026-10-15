/** This listener's own sound. Never sent to the room. */
export interface AudioPreferences {
  volume: number;
  muted: boolean;
}

/** Where someone starts before they have touched the slider: loud enough to hear, not full blast. */
export const INITIAL_AUDIO: AudioPreferences = { volume: 80, muted: false };

const KEY = "musicplayer.audio";

/**
 * Reads the remembered volume. Whatever is stored is checked, not trusted: an
 * old format, a hand edit, or a browser that refuses storage (private mode
 * can throw) all come back as the initial volume rather than as an error.
 */
export function readAudioPreferences(storage: Pick<Storage, "getItem">): AudioPreferences {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return INITIAL_AUDIO;

    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return INITIAL_AUDIO;
    const { volume, muted } = value as Record<string, unknown>;

    return typeof volume === "number" &&
      Number.isInteger(volume) &&
      volume >= 0 &&
      volume <= 100 &&
      typeof muted === "boolean"
      ? { volume, muted }
      : INITIAL_AUDIO;
  } catch {
    return INITIAL_AUDIO;
  }
}

export function writeAudioPreferences(
  storage: Pick<Storage, "setItem">,
  audio: AudioPreferences,
): void {
  try {
    storage.setItem(KEY, JSON.stringify({ volume: Math.round(audio.volume), muted: audio.muted }));
  } catch {
    // Storage full or refused: the volume still applies, it just will not be remembered.
  }
}
