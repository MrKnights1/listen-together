import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ProviderId } from "@/shared/domain/TrackRef.ts";
import type { PlayerAdapter, PlayerEvents } from "./PlayerAdapter.ts";
import type { SyncStatus, Target } from "./reconcile.ts";
import { SyncedPlayer } from "./SyncedPlayer.ts";
import { createYouTubeAdapter } from "./youtube/createYouTubeAdapter.ts";

/** One factory per provider. Spotify would be a second line here. */
const PROVIDERS: Record<
  ProviderId,
  (host: HTMLElement, events: PlayerEvents) => Promise<PlayerAdapter>
> = {
  youtube: createYouTubeAdapter,
};

/** About once a second: often enough to catch drift, cheap enough to ignore. */
const TICK_MS = 1000;

export interface SyncedPlayerState {
  status: SyncStatus;
  errorCode: number | null;
  /** True after the browser refused sound: the "Start listening" button must come back. */
  autoplayBlocked: boolean;
  resync: () => void;
}

/**
 * Runs the sync loop for the room page. `target` is read on every tick, so it
 * may close over the latest room state without restarting anything.
 */
export function useSyncedPlayer({
  hostRef,
  target,
  listening,
  volume,
  muted,
  onAutoplayBlocked,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  target: (localNow: number) => Target | null;
  listening: boolean;
  volume: number;
  muted: boolean;
  onAutoplayBlocked: () => void;
}): SyncedPlayerState {
  const targetRef = useRef(target);
  targetRef.current = target;
  const blockedRef = useRef(onAutoplayBlocked);
  blockedRef.current = onAutoplayBlocked;

  const [status, setStatus] = useState<{ status: SyncStatus; errorCode: number | null }>({
    status: "idle",
    errorCode: null,
  });
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const playerRef = useRef<SyncedPlayer | null>(null);

  useEffect(() => {
    const player = new SyncedPlayer({
      createAdapter: async (provider, events) => {
        const host = hostRef.current;
        if (host === null) throw new Error("The player tile is not on the page.");
        return await PROVIDERS[provider](host, events);
      },
      target: (localNow) => targetRef.current(localNow),
      now: () => performance.now(),
      onStatus: (next, errorCode) => setStatus({ status: next, errorCode }),
      onAutoplayBlocked: () => {
        setAutoplayBlocked(true);
        blockedRef.current();
      },
    });
    playerRef.current = player;
    const interval = setInterval(() => player.tick(), TICK_MS);
    return () => {
      clearInterval(interval);
      player.destroy();
      playerRef.current = null;
    };
  }, [hostRef]);

  useEffect(() => {
    if (listening) setAutoplayBlocked(false);
    playerRef.current?.setListening(listening);
  }, [listening]);

  useEffect(() => {
    playerRef.current?.setAudio(volume, muted);
  }, [volume, muted]);

  const resync = useCallback(() => playerRef.current?.resync(), []);

  return { ...status, autoplayBlocked, resync };
}
