import { useEffect, useRef } from "react";
import {
  MediaKeys,
  type MediaSessionPort,
  type NowPlayingInfo,
  type RoomPlayback,
  type SilentLoop,
} from "./MediaKeys.ts";
import { silentWav } from "./silentWav.ts";

/** Ten seconds at 8 kHz, looped: 80 KB held while listening. */
const LOOP_SECONDS = 10;
const LOOP_SAMPLE_RATE = 8000;

const browserSession: MediaSessionPort = {
  setMetadata: (info) => {
    navigator.mediaSession.metadata =
      info === null
        ? null
        : new MediaMetadata({
            title: info.title,
            artist: info.artist,
            artwork: info.artworkUrl === null ? [] : [{ src: info.artworkUrl }],
          });
  },
  setPlaybackState: (state) => {
    navigator.mediaSession.playbackState = state;
  },
  setActionHandler: (action, handler) => navigator.mediaSession.setActionHandler(action, handler),
};

/** Not muted: the sound is silence already, so the page plays as any player would. */
function browserLoop(): SilentLoop {
  const wav = new Blob([silentWav(LOOP_SECONDS, LOOP_SAMPLE_RATE)], { type: "audio/wav" });
  const url = URL.createObjectURL(wav);
  const audio = new Audio(url);
  audio.loop = true;
  return {
    play: () => audio.play(),
    pause: () => audio.pause(),
    destroy: () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * The media keys for the room page. The callbacks are read when a key is
 * pressed, so they may close over the latest room state.
 */
export function useMediaKeys({
  listening,
  playback,
  songPlaying,
  nowPlaying,
  onPlay,
  onPause,
  onNext,
}: {
  listening: boolean;
  playback: RoomPlayback;
  songPlaying: boolean;
  nowPlaying: NowPlayingInfo | null;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
}): void {
  const actionsRef = useRef({ onPlay, onPause, onNext });
  actionsRef.current = { onPlay, onPause, onNext };
  const keysRef = useRef<MediaKeys | null>(null);

  useEffect(() => {
    const keys = new MediaKeys({
      session: browserSession,
      createLoop: browserLoop,
      onPlay: () => actionsRef.current.onPlay(),
      onPause: () => actionsRef.current.onPause(),
      onNext: () => actionsRef.current.onNext(),
    });
    keysRef.current = keys;
    return () => {
      keys.destroy();
      keysRef.current = null;
    };
  }, []);

  useEffect(() => {
    keysRef.current?.update({ listening, playback, songPlaying, nowPlaying });
  }, [listening, playback, songPlaying, nowPlaying]);
}
