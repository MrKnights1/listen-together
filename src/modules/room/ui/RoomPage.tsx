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
import { BrandMark } from "@/shared/ui/BrandMark.tsx";
import { Icon } from "@/shared/ui/Icon.tsx";
import {
  ActivityFeed,
  AddTrackForm,
  ArtworkGlow,
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
    if (connection === "not_allowed") window.location.replace("/login?error=removed");
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

  const moveEntry = useCallback(
    (entryId: string, toIndex: number) => control({ type: "move", entryId, toIndex }),
    [control],
  );
  const removeEntry = useCallback(
    (entryId: string) => control({ type: "remove", entryId }),
    [control],
  );
  const shuffleMine = useCallback(() => {
    if (room.you !== null) control({ type: "shuffle", ownerId: room.you });
  }, [room.you, control]);

  const rows = useMemo<QueueRow[]>(
    () =>
      state.queue.flatMap((entryId) => {
        const entry = state.entries[entryId];
        if (entry === undefined) return [];
        return [
          {
            entryId,
            ownerId: entry.ownerId,
            track: tracks[entry.trackId],
            durationMs: entry.durationMs,
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
      <div className="shell">
        <div className="pane pane--rail">
          <header className="brand">
            <BrandMark className="brand__mark" />
            <h1 className="brand__name">Listening room</h1>
          </header>
          <ListenerList listeners={room.listeners} people={people} you={room.you} />
          <div className="me">
            {listening && (
              <section className="me__listening" aria-labelledby="me-heading">
                <div>
                  <h2 id="me-heading">Your listening</h2>
                  <p className="me__note">Only you hear these. Nobody else&apos;s sound changes.</p>
                </div>
                <div className="me__listen">
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
                </div>
              </section>
            )}
            <div className="account">
              <img className="account__avatar" src={me.avatarUrl} alt="" width={32} height={32} />
              <div className="account__text">
                <span className="account__who">
                  Signed in as <strong>{me.name}</strong>
                </span>
                <span className="account__links">
                  {me.isAdmin && <a href="/admin">Manage guests</a>}
                  <SignOutButton />
                </span>
              </div>
            </div>
          </div>
        </div>

        <main className="pane pane--centre">
          <ConnectionBanner state={connection} />
          <section className="hero" aria-label="Now playing">
            <ArtworkGlow artworkUrl={currentTrack?.artworkUrl ?? null} />
            <PlayerTile hostRef={hostRef} idle={current === null} />
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
            <VolumeControl
              volume={audio.volume}
              muted={audio.muted}
              onVolume={(volume) => changeAudio({ ...audio, volume })}
              onMuted={(muted) => changeAudio({ ...audio, muted })}
            />
            {listening ? (
              <p className="hero__hint">
                <Icon name="people" />
                Volume is just yours. The rest moves the room for everyone.
              </p>
            ) : (
              <div className="hero__listen">
                <ListenButton
                  listening={listening}
                  onStart={() => setListening(true)}
                  onStop={() => setListening(false)}
                />
              </div>
            )}
          </section>
          {notice !== null && (
            <p className="notice room-notice" role="alert">
              <Icon name="alert" />
              {notice}
            </p>
          )}
          <UpNextList
            rows={rows}
            people={people}
            you={room.you}
            onMove={moveEntry}
            onRemove={removeEntry}
            onShuffleMine={shuffleMine}
          />
        </main>

        <div className="pane pane--side">
          <AddTrackForm
            onAdd={async (url, scope) => {
              const outcome = await command({ type: "add", url, scope });
              if (!outcome.ok) return refusal(outcome.code);
              return outcome.result === null ? "Added." : addSummary(outcome.result);
            }}
          />
          <ActivityFeed activity={room.activity} people={people} />
        </div>
      </div>
    </>
  );
}
