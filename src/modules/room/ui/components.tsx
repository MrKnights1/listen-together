import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import type { SyncStatus } from "@/modules/player/ui/index.ts";
import type { ListenerView, Person } from "@/modules/room/contract/messages.ts";
import type { ActivityEntry } from "@/modules/room/domain/activity.ts";
import type { RepeatMode } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import type { ConnectionState } from "./RoomConnection.ts";
import { ownerColor } from "./ownerColor.ts";
import { activityLine, formatDuration, presenceLine } from "./wording.ts";

function Avatar({ person, size }: { person: Person | undefined; size: number }) {
  // Decorative: the name is always written beside it.
  return person === undefined ? (
    <span
      className="avatar avatar--unknown"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  ) : (
    <img
      className="avatar"
      src={person.avatarUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
    />
  );
}

export function OwnerChip({ ownerId, person }: { ownerId: string; person: Person | undefined }) {
  return (
    <span className="owner" style={{ "--owner": ownerColor(ownerId) } as React.CSSProperties}>
      <Avatar person={person} size={22} />
      <span className="owner__name">{person?.name ?? "Someone"}</span>
    </span>
  );
}

/**
 * The current song's artwork, blurred into a glow behind "now playing". A
 * layer of its own under everything else: it never reaches the player tile.
 */
export function ArtworkGlow({ artworkUrl }: { artworkUrl: string | null }) {
  return (
    <>
      {artworkUrl !== null && (
        <img className="hero__glow" src={artworkUrl} alt="" aria-hidden="true" />
      )}
      <div className="hero__scrim" aria-hidden="true" />
    </>
  );
}

export function NowPlaying({
  track,
  ownerId,
  owner,
}: {
  track: TrackInfo | undefined;
  ownerId: string | null;
  owner: Person | undefined;
}) {
  if (track === undefined || ownerId === null) {
    return (
      <div className="now">
        <p className="now__title now__title--empty">Nothing is playing</p>
        <p className="now__artist">Paste a YouTube link to start the room.</p>
      </div>
    );
  }
  return (
    <div className="now">
      <p className="now__title" title={track.title}>
        {track.title}
      </p>
      <p className="now__artist">{track.artist}</p>
      <p className="now__owner">
        Queued by <OwnerChip ownerId={ownerId} person={owner} />
      </p>
    </div>
  );
}

/**
 * The room's position, which anyone may move. Seeks on release, not on every
 * pixel dragged: the room hears one jump, not a hundred.
 */
export function SeekBar({
  positionMs,
  durationMs,
  disabled,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  disabled: boolean;
  onSeek: (positionMs: number) => void;
}) {
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = useEffectEvent((seconds: number) => {
    onSeek(seconds * 1000);
    setScrubbing(null);
  });

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    const onChange = () => commit(Number(input.value));
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  const shown = scrubbing ?? positionMs;
  return (
    <div className="seek">
      <span className="seek__time">{formatDuration(shown)}</span>
      <input
        ref={inputRef}
        className="range"
        type="range"
        min={0}
        max={Math.max(1, Math.floor(durationMs / 1000))}
        step={1}
        value={Math.floor(shown / 1000)}
        disabled={disabled}
        aria-label="Position in the song (moves it for everyone)"
        aria-valuetext={`${formatDuration(shown)} of ${formatDuration(durationMs)}`}
        onChange={(event) => setScrubbing(Number(event.currentTarget.value) * 1000)}
        style={
          {
            "--progress": `${durationMs === 0 ? 0 : (100 * shown) / durationMs}%`,
          } as React.CSSProperties
        }
      />
      <span className="seek__time">{formatDuration(durationMs)}</span>
    </div>
  );
}

const REPEAT_NEXT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat is off",
  all: "Repeating the whole queue",
  one: "Repeating this song",
};

/**
 * Play and skip around a big round key, shuffle and repeat beside them. Two
 * groups so each can sit where the layout wants it; both act for everyone.
 */
export function TransportControls({
  status,
  repeat,
  onToggle,
  onSkip,
  onShuffle,
  onRepeat,
}: {
  status: "playing" | "paused" | "idle";
  repeat: RepeatMode;
  onToggle: () => void;
  onSkip: () => void;
  onShuffle: () => void;
  onRepeat: (mode: RepeatMode) => void;
}) {
  const idle = status === "idle";
  const toggle = status === "playing" ? "Pause" : "Resume";
  return (
    <>
      <div className="transport" role="group" aria-label="Room playback (for everyone)">
        <button
          type="button"
          className="play"
          disabled={idle}
          aria-label={toggle}
          title={toggle}
          onClick={onToggle}
        >
          <Icon name={status === "playing" ? "pause" : "play"} />
        </button>
        <button
          type="button"
          className="round"
          disabled={idle}
          aria-label="Skip"
          title="Skip"
          onClick={onSkip}
        >
          <Icon name="skip" />
        </button>
      </div>
      <div className="modes" role="group" aria-label="Room order (for everyone)">
        <button
          type="button"
          className="icon-button"
          aria-label="Shuffle all"
          title="Shuffle all"
          onClick={onShuffle}
        >
          <Icon name="shuffle" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={REPEAT_LABEL[repeat]}
          title={REPEAT_LABEL[repeat]}
          aria-pressed={repeat !== "off"}
          onClick={() => onRepeat(REPEAT_NEXT[repeat])}
        >
          <Icon name={repeat === "one" ? "repeat-one" : "repeat"} />
        </button>
      </div>
    </>
  );
}

/**
 * Browsers will not start sound without a click, so listening starts with
 * one — beside the player, never over it. Stopping is this listener's alone:
 * the room plays on for everyone else.
 */
export function ListenButton({
  listening,
  onStart,
  onStop,
}: {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return listening ? (
    <button type="button" className="button" onClick={onStop}>
      Stop listening
    </button>
  ) : (
    <button type="button" className="button button--primary button--large" onClick={onStart}>
      <Icon name="headphones" />
      Start listening
    </button>
  );
}

export function SyncNotice({
  listening,
  status,
  errorCode,
  onResync,
}: {
  listening: boolean;
  status: SyncStatus;
  errorCode: number | null;
  onResync: () => void;
}) {
  if (!listening) return null;
  return (
    <p className={`sync sync--${status}`} role="status">
      <span className="sync__dot" aria-hidden="true" />
      {presenceLine(true, status, errorCode)}
      {(status === "out_of_sync" || status === "error") && (
        <button type="button" className="link-button" onClick={onResync}>
          Try again
        </button>
      )}
    </p>
  );
}

export interface QueueRow {
  entryId: string;
  ownerId: string;
  track: TrackInfo | undefined;
  durationMs: number;
}

export function UpNextList({
  rows,
  people,
  you,
  onMove,
  onRemove,
  onShuffleMine,
}: {
  rows: QueueRow[];
  people: Record<string, Person>;
  you: string | null;
  onMove: (entryId: string, toIndex: number) => void;
  onRemove: (entryId: string) => void;
  onShuffleMine: () => void;
}) {
  const mine = rows.filter((row) => row.ownerId === you).length;
  return (
    <section className="upnext" aria-labelledby="upnext-heading" id="upnext">
      <div className="upnext__head">
        <h2 id="upnext-heading">Up next</h2>
        <button
          type="button"
          className="button button--small"
          disabled={mine < 2}
          onClick={onShuffleMine}
        >
          <Icon name="shuffle" />
          Shuffle my songs
        </button>
      </div>
      <p className="upnext__note">Songs play in the order they were added.</p>
      {rows.length === 0 ? (
        <p className="empty">Nothing queued. Paste a link to add the next song.</p>
      ) : (
        <ol className="queue">
          {rows.map((row, index) => {
            const title = row.track?.title ?? "Unknown song";
            const owner = people[row.ownerId];
            return (
              <li
                key={row.entryId}
                className="row"
                style={{ "--owner": ownerColor(row.ownerId) } as React.CSSProperties}
              >
                <span className="row__n" aria-hidden="true">
                  {index + 1}
                </span>
                {row.track?.artworkUrl ? (
                  <img
                    className="row__art"
                    src={row.track.artworkUrl}
                    alt=""
                    width={64}
                    height={36}
                    loading="lazy"
                  />
                ) : (
                  <span className="row__art" aria-hidden="true" />
                )}
                <span className="row__text">
                  <span className="row__title">{title}</span>
                  {row.track !== undefined && (
                    <span className="row__artist">{row.track.artist}</span>
                  )}
                </span>
                <span className="row__meta">
                  <OwnerChip ownerId={row.ownerId} person={owner} />
                  <span className="row__len">{formatDuration(row.durationMs)}</span>
                </span>
                <span className="row__actions">
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === 0}
                    aria-label={`Move ${title} earlier in the queue`}
                    title="Move earlier"
                    onClick={() => onMove(row.entryId, index - 1)}
                  >
                    <Icon name="up" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={index === rows.length - 1}
                    aria-label={`Move ${title} later in the queue`}
                    title="Move later"
                    onClick={() => onMove(row.entryId, index + 1)}
                  >
                    <Icon name="down" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove ${title} from the queue`}
                    title="Remove"
                    onClick={() => onRemove(row.entryId)}
                  >
                    <Icon name="remove" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function AddTrackForm({ onAdd }: { onAdd: (url: string) => Promise<string> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const added = message?.startsWith("Added") ?? false;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (url.trim() === "" || busy) return;
    setBusy(true);
    setMessage(null);
    const reply = await onAdd(url.trim());
    setBusy(false);
    setMessage(reply);
    if (reply.startsWith("Added")) setUrl("");
  }

  return (
    <section className="add" aria-labelledby="add-heading">
      <h2 id="add-heading">Add songs</h2>
      <form className="add__form" onSubmit={(event) => void submit(event)}>
        <label className="add__label" htmlFor="add-url">
          YouTube video or playlist link
        </label>
        <div className="add__row">
          <input
            id="add-url"
            className="input add__input"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://youtu.be/…"
            value={url}
            onChange={(event) => setUrl(event.currentTarget.value)}
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || url.trim() === ""}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </form>
      <p className={added ? "add__result add__result--added" : "add__result"} role="status">
        {added && <Icon name="check" />}
        {message}
      </p>
    </section>
  );
}

export function ListenerList({
  listeners,
  people,
  you,
}: {
  listeners: ListenerView[];
  people: Record<string, Person>;
  you: string | null;
}) {
  return (
    <section className="people" aria-labelledby="listeners-heading">
      <h2 id="listeners-heading">Listening now</h2>
      <ul className="listeners">
        {listeners.map((listener) => {
          const person = people[listener.userId];
          const state = listener.listening ? listener.sync : "away";
          return (
            <li
              key={listener.userId}
              className="listener"
              style={{ "--owner": ownerColor(listener.userId) } as React.CSSProperties}
            >
              <span className="face">
                <Avatar person={person} size={36} />
                <span className={`face__dot face__dot--${state}`} aria-hidden="true" />
              </span>
              <span className="listener__text">
                <span className="listener__name">
                  {person?.name ?? "Someone"}
                  {listener.userId === you && <span className="listener__you"> (you)</span>}
                </span>
                <span className={`listener__state listener__state--${state}`}>
                  {presenceLine(listener.listening, listener.sync, listener.errorCode)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ActivityFeed({
  activity,
  people,
}: {
  activity: ActivityEntry[];
  people: Record<string, Person>;
}) {
  const latestFirst = [...activity].reverse();
  return (
    <section className="activity" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      {latestFirst.length === 0 ? (
        <p className="empty">Nothing has happened yet.</p>
      ) : (
        <ol className="feed">
          {latestFirst.map((entry) => (
            <li key={entry.id} className="feed__row">
              <time className="feed__time" dateTime={new Date(entry.at).toISOString()}>
                {clockTime(entry.at)}
              </time>
              <span className={entry.actorId === null ? "feed__system" : undefined}>
                {entry.actorId !== null && (
                  <strong className="feed__who">{people[entry.actorId]?.name ?? "Someone"} </strong>
                )}
                {activityLine(entry)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const CONNECTION_TEXT: Partial<Record<ConnectionState, string>> = {
  connecting: "Joining the room…",
  reconnecting: "Lost the connection. Reconnecting…",
};

export function ConnectionBanner({ state }: { state: ConnectionState }) {
  const text = CONNECTION_TEXT[state];
  return (
    <p className="banner" role="status" hidden={text === undefined}>
      <Icon name="spinner" className="banner__spinner" />
      {text}
    </p>
  );
}
