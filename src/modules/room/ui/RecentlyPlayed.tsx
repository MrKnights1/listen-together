import { memo, useState } from "react";
import type { Person } from "@/modules/room/contract/messages.ts";
import type { PlayedSong } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { OwnerChip } from "./OwnerChip.tsx";
import { clockTime } from "./wording.ts";

/**
 * The songs the room moved on from, newest first, each one click from being
 * queued again. The + is left out where it would add nothing: for a song
 * coming up anyway, and for all of them while the whole queue repeats.
 */
export const RecentlyPlayed = memo(function RecentlyPlayed({
  played,
  tracks,
  people,
  repeatingAll,
  comingUp,
  onAddAgain,
}: {
  played: PlayedSong[];
  tracks: Record<string, TrackInfo>;
  people: Record<string, Person>;
  repeatingAll: boolean;
  /** The songs playing or in Up next, by track id, whoever queued them. */
  comingUp: ReadonlySet<string>;
  /** Queues the song in this listener's own list; resolves to what that did, in words. */
  onAddAgain: (track: TrackInfo) => Promise<string>;
}) {
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const addAgain = async (track: TrackInfo) => {
    setAdding(true);
    setResult(await onAddAgain(track));
    setAdding(false);
  };

  return (
    <section className="recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recently played</h2>
      {played.length === 0 ? (
        <p className="empty">Nothing has played yet.</p>
      ) : (
        <ol className="recent__list">
          {played.map((song) => {
            const track = tracks[song.trackId];
            const title = track?.title ?? "Unknown song";
            return (
              <li key={song.trackId} className="recent__row">
                {track?.artworkUrl ? (
                  <img
                    className="recent__art"
                    src={track.artworkUrl}
                    alt=""
                    width={48}
                    height={27}
                    loading="lazy"
                  />
                ) : (
                  <span className="recent__art" aria-hidden="true" />
                )}
                <span className="recent__text">
                  <span className="recent__title">{title}</span>
                  <span className="recent__meta">
                    <OwnerChip ownerId={song.ownerId} person={people[song.ownerId]} />
                    <time className="recent__time" dateTime={new Date(song.at).toISOString()}>
                      {clockTime(song.at)}
                    </time>
                  </span>
                </span>
                {track !== undefined && !repeatingAll && !comingUp.has(song.trackId) && (
                  <button
                    type="button"
                    className="icon-button recent__add"
                    disabled={adding}
                    aria-label={`Add ${title} again`}
                    title="Add again"
                    onClick={() => void addAgain(track)}
                  >
                    <Icon name="plus" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {result !== null && (
        <p className="recent__result" role="status">
          {result}
        </p>
      )}
    </section>
  );
});
