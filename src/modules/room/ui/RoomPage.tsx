import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignOutButton, type SessionUser } from "@/modules/identity/ui/index.ts";
import {
  PlayerTile,
  readAudioPreferences,
  useSyncedPlayer,
  VolumeControl,
  writeAudioPreferences,
  type AudioPreferences,
  type Target,
} from "@/modules/player/ui/index.ts";
import type { CommandOp } from "@/modules/room/contract/messages.ts";
import { positionAt } from "@/modules/room/domain/playback.ts";
import type { RepeatMode } from "@/modules/room/domain/RoomState.ts";
import { upcoming } from "@/modules/room/domain/upcoming.ts";
import {
  ActivityFeed,
  AddTrackForm,
  ConnectionBanner,
  ListenButton,
  ListenerList,
  NowPlaying,
  SeekBar,
  SyncNotice,
  TransportControls,
  UpNextList,
  type QueueRow,
} from "./components.tsx";
import { useRoom } from "./useRoom.ts";
import { addSummary, refusal } from "./wording.ts";

/** This device's monotonic time, refreshed every `ms` so the clock and seek bar move. */
function useTicker(ms: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const handle = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(handle);
  }, [ms]);
  return now;
}

export function RoomPage({ me }: { me: SessionUser }) {
  const { room, connection, clock, command, setPresence } = useRoom();
  const [audio, setAudio] = useState<AudioPreferences>(() =>
    readAudioPreferences(window.localStorage),
  );
  const [listening, setListening] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const now = useTicker(500);

  useEffect(() => {
    if (connection === "signed_out") window.location.replace("/login");
    if (connection === "not_allowed") window.location.replace("/login?error=not_allowed");
  }, [connection]);

  const changeAudio = useCallback((next: AudioPreferences) => {
    setAudio(next);
    writeAudioPreferences(window.localStorage, next);
  }, []);

  const { state, tracks, people } = room;
  const current = state.current;
  const currentEntry = current === null ? undefined : state.entries[current.entryId];
  const currentTrack = currentEntry === undefined ? undefined : tracks[currentEntry.trackId];

  const target = (localNow: number): Target | null => {
    if (
      !clock.synced ||
      current === null ||
      currentEntry === undefined ||
      currentTrack === undefined
    ) {
      return null;
    }
    return {
      provider: currentTrack.provider,
      providerTrackId: currentTrack.providerTrackId,
      playing: current.status === "playing",
      positionMs: positionAt(state, clock.serverNow(localNow)),
      durationMs: currentEntry.durationMs,
    };
  };

  const player = useSyncedPlayer({
    hostRef,
    target,
    listening,
    volume: audio.volume,
    muted: audio.muted,
    onAutoplayBlocked: () => setListening(false),
  });

  useEffect(() => {
    setPresence({ listening, sync: player.status, errorCode: player.errorCode });
  }, [listening, player.status, player.errorCode, setPresence, connection]);

  const send = useCallback(
    async (op: CommandOp) => {
      const outcome = await command(op);
      return outcome.ok ? null : refusal(outcome.code);
    },
    [command],
  );
  const [notice, setNotice] = useState<string | null>(null);
  const control = useCallback(
    (op: CommandOp) => {
      void send(op).then(setNotice);
    },
    [send],
  );

  const togglePause = useCallback(() => {
    if (current === null) return;
    control({ type: current.status === "playing" ? "pause" : "resume", entryId: current.entryId });
  }, [current, control]);

  const rows = useMemo<QueueRow[]>(
    () =>
      upcoming(state).flatMap((entryId) => {
        const entry = state.entries[entryId];
        if (entry === undefined) return [];
        const lane = state.lanes[entry.ownerId] ?? [];
        return [
          {
            entryId,
            ownerId: entry.ownerId,
            track: tracks[entry.trackId],
            durationMs: entry.durationMs,
            laneIndex: lane.indexOf(entryId),
            laneLength: lane.length,
          },
        ];
      }),
    [state, tracks],
  );

  const positionMs =
    current === null
      ? 0
      : clock.synced
        ? positionAt(state, clock.serverNow(now))
        : current.positionMs;

  return (
    <>
      <a className="skip-link" href="#upnext">
        Skip to the queue
      </a>
      <header className="nowbar" aria-label="Now playing">
        <div className="nowbar__inner">
          <PlayerTile hostRef={hostRef} idle={current === null} />
          <div className="nowbar__main">
            <NowPlaying
              track={currentTrack}
              ownerId={currentEntry?.ownerId ?? null}
              owner={currentEntry ? people[currentEntry.ownerId] : undefined}
            />
            <SeekBar
              positionMs={positionMs}
              durationMs={currentEntry?.durationMs ?? 0}
              disabled={current === null}
              onSeek={(ms) =>
                current !== null &&
                control({ type: "seek", entryId: current.entryId, positionMs: Math.round(ms) })
              }
            />
            <TransportControls
              status={current === null ? "idle" : current.status}
              repeat={state.repeat}
              onToggle={togglePause}
              onSkip={() => current !== null && control({ type: "skip", entryId: current.entryId })}
              onShuffle={() => control({ type: "shuffle", ownerId: null })}
              onRepeat={(mode: RepeatMode) => control({ type: "repeat", mode })}
            />
            {notice !== null && (
              <p className="notice" role="alert">
                {notice}
              </p>
            )}
          </div>
          <div className="nowbar__me">
            <ListenButton
              listening={listening}
              onStart={() => setListening(true)}
              onStop={() => setListening(false)}
            />
            <SyncNotice
              listening={listening}
              status={player.status}
              errorCode={player.errorCode}
              onResync={player.resync}
            />
            <VolumeControl
              volume={audio.volume}
              muted={audio.muted}
              onVolume={(volume) => changeAudio({ ...audio, volume })}
              onMuted={(muted) => changeAudio({ ...audio, muted })}
            />
            <p className="nowbar__who">
              Signed in as {me.name}. <SignOutButton />
            </p>
          </div>
        </div>
        <ConnectionBanner state={connection} />
      </header>

      <main className="room">
        <h1 className="visually-hidden">Listening room</h1>
        <UpNextList
          rows={rows}
          people={people}
          you={room.you}
          onMove={(entryId, toIndex) => control({ type: "move", entryId, toIndex })}
          onRemove={(entryId) => control({ type: "remove", entryId })}
          onShuffleMine={() => room.you !== null && control({ type: "shuffle", ownerId: room.you })}
        />
        <div className="room__side">
          <AddTrackForm
            onAdd={async (url) => {
              const outcome = await command({ type: "add", url });
              if (!outcome.ok) return refusal(outcome.code);
              return outcome.result === null ? "Added." : addSummary(outcome.result);
            }}
          />
          <ListenerList listeners={room.listeners} people={people} />
          <ActivityFeed activity={room.activity} people={people} />
        </div>
      </main>
    </>
  );
}
