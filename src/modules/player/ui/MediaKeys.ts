/** What the system's media controls show: the song the room is on. */
export interface NowPlayingInfo {
  title: string;
  artist: string;
  artworkUrl: string | null;
}

export type RoomPlayback = "playing" | "paused" | "idle";

/** The keys handled. No previous track: the room has no song to go back to. */
export const MEDIA_KEY_ACTIONS = ["play", "pause", "nexttrack"] as const;
export type MediaKeyAction = (typeof MEDIA_KEY_ACTIONS)[number];

/** Just enough of `navigator.mediaSession` that tests need no browser. */
export interface MediaSessionPort {
  setMetadata(info: NowPlayingInfo | null): void;
  setPlaybackState(state: "none" | "paused" | "playing"): void;
  setActionHandler(action: MediaKeyAction, handler: (() => void) | null): void;
}

/** A looping silent sound that plays and pauses with the room. */
export interface SilentLoop {
  play(): Promise<void>;
  pause(): void;
  destroy(): void;
}

export interface MediaKeysOptions {
  session: MediaSessionPort;
  createLoop: () => SilentLoop;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
}

export interface MediaKeysView {
  listening: boolean;
  playback: RoomPlayback;
  /** This listener's song player is still playing, whatever the room now says. */
  songPlaying: boolean;
  nowPlaying: NowPlayingInfo | null;
}

function sameSong(a: NowPlayingInfo | null, b: NowPlayingInfo | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.title === b.title &&
      a.artist === b.artist &&
      a.artworkUrl === b.artworkUrl)
  );
}

/**
 * Hands the keyboard's and the system's media keys to the room while this
 * listener listens. Browsers send the keys to the frame that plays sound,
 * and the song plays in the provider's cross-origin frame — so this page
 * plays a silent loop of its own, in step with the room, to be that frame.
 * Played or paused with the room, the loop also keeps a single play/pause
 * key pressing the right one of the two.
 *
 * Chrome drops a paused player from the session while another still plays,
 * and keeps only the last one to pause. So the loop pauses after the song's
 * own player has, and plays once on starting even into a paused room: a
 * player that never played was never in the session to be kept.
 */
export class MediaKeys {
  private loop: SilentLoop | null = null;
  private loopStarted = false;
  private loopPlaying = false;
  private playback: RoomPlayback = "idle";
  private shown: NowPlayingInfo | null = null;

  constructor(private readonly options: MediaKeysOptions) {}

  update(view: MediaKeysView): void {
    if (!view.listening) {
      this.release();
      return;
    }
    const { session } = this.options;
    if (this.loop === null) {
      this.loop = this.options.createLoop();
      for (const action of MEDIA_KEY_ACTIONS) {
        session.setActionHandler(action, () => this.press(action));
      }
    }
    this.playback = view.playback;
    if (!sameSong(this.shown, view.nowPlaying)) {
      this.shown = view.nowPlaying;
      session.setMetadata(view.nowPlaying);
    }
    session.setPlaybackState(view.playback === "idle" ? "none" : view.playback);
    this.follow(view.playback === "playing" || view.songPlaying);
  }

  destroy(): void {
    this.release();
  }

  /** A key acts only when it changes something: pausing a paused room is no command. */
  private press(action: MediaKeyAction): void {
    if (action === "play" && this.playback === "paused") this.options.onPlay();
    if (action === "pause" && this.playback === "playing") this.options.onPause();
    if (action === "nexttrack" && this.playback !== "idle") this.options.onNext();
  }

  private follow(playing: boolean): void {
    const loop = this.loop;
    if (loop === null || (this.loopStarted && playing === this.loopPlaying)) return;
    this.loopPlaying = playing;
    if (!playing && this.loopStarted) {
      loop.pause();
      return;
    }
    this.loopStarted = true;
    loop.play().then(
      // Started only to join the session: rest now, as the room does.
      () => {
        if (!this.loopPlaying && this.loop === loop) loop.pause();
      },
      (error: unknown) => {
        // Paused again before it started: nothing went wrong.
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("The silent loop for the media keys would not play", error);
      },
    );
  }

  private release(): void {
    const loop = this.loop;
    if (loop === null) return;
    const { session } = this.options;
    for (const action of MEDIA_KEY_ACTIONS) session.setActionHandler(action, null);
    session.setMetadata(null);
    session.setPlaybackState("none");
    loop.destroy();
    this.loop = null;
    this.loopStarted = false;
    this.loopPlaying = false;
    this.playback = "idle";
    this.shown = null;
  }
}
