import { memo, useMemo, useState } from "react";
import type { Person } from "@/modules/room/contract/messages.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog.tsx";
import { Icon } from "@/shared/ui/Icon.tsx";
import { OwnerChip } from "./OwnerChip.tsx";
import { ownerColor } from "./ownerColor.ts";
import { clearQuestion, formatDuration, songs } from "./wording.ts";

export interface QueueRow {
  entryId: string;
  ownerId: string;
  track: TrackInfo | undefined;
  durationMs: number;
  addedAt: number;
}

/** The queue as it was when "Clear queue" was clicked: what the person is asked about. */
interface ClearRequest {
  count: number;
  addedUpTo: number;
}

function clearRequest(rows: QueueRow[]): ClearRequest {
  return {
    count: rows.length,
    addedUpTo: rows.reduce((newest, row) => Math.max(newest, row.addedAt), 0),
  };
}

/** What the list says about how the next song is chosen. */
function orderNote(shuffle: boolean, anyStarred: boolean): string {
  if (!shuffle) return "Songs play in the order they were added.";
  return anyStarred
    ? "Shuffle is on: starred songs play first, in the order they were starred, then each next song is picked at random."
    : "Shuffle is on: each next song is picked at random. Star a song to play it next.";
}

/**
 * Memoised: the page re-renders twice a second to move the clock, and a full
 * room is 5000 rows. The list only re-renders when the queue or people change.
 */
export const UpNextList = memo(function UpNextList({
  rows,
  shuffle,
  starred,
  people,
  onMove,
  onStar,
  onRemove,
  onShuffleQueue,
  onClear,
}: {
  rows: QueueRow[];
  /**
   * While on, the list is a pool to draw from, not a running order: it drops
   * its numbers and its move buttons, and songs can be starred to play next.
   */
  shuffle: boolean;
  /** The entries starred to play next, in the order they play. Shown only while shuffle is on. */
  starred: string[];
  people: Record<string, Person>;
  onMove: (entryId: string, toIndex: number) => void;
  onStar: (entryId: string, on: boolean) => void;
  onRemove: (entryId: string) => void;
  /** Puts every queued song, whoever added it, in a new random order once. */
  onShuffleQueue: () => void;
  /** Clears every queued song added up to `addedUpTo`, once the person has said yes. */
  onClear: (addedUpTo: number) => void;
}) {
  const [clearing, setClearing] = useState<ClearRequest | null>(null);
  /** Each starred entry's place in the starred line, from 1. */
  const starPlaces = useMemo(
    () => new Map(starred.map((entryId, index) => [entryId, index + 1])),
    [starred],
  );
  return (
    <section className="upnext" aria-labelledby="upnext-heading" id="upnext">
      <div className="upnext__head">
        <div className="upnext__title">
          <h2 id="upnext-heading">Up next</h2>
          <span className="upnext__count">{songs(rows.length)}</span>
        </div>
        <div className="upnext__actions">
          <button
            type="button"
            className="button button--small"
            disabled={rows.length < 2}
            onClick={onShuffleQueue}
          >
            <Icon name="shuffle" />
            Shuffle queue
          </button>
          <button
            type="button"
            className="button button--small button--danger"
            disabled={rows.length === 0}
            onClick={() => setClearing(clearRequest(rows))}
          >
            <Icon name="remove" />
            Clear queue
          </button>
        </div>
      </div>
      {clearing !== null && (
        <ConfirmDialog
          title="Clear the queue?"
          message={clearQuestion(clearing.count)}
          confirmLabel="Clear queue"
          cancelLabel="Keep songs"
          onConfirm={() => {
            setClearing(null);
            onClear(clearing.addedUpTo);
          }}
          onCancel={() => setClearing(null)}
        />
      )}
      <p className="upnext__note">{orderNote(shuffle, starred.length > 0)}</p>
      {rows.length === 0 ? (
        <p className="empty">Nothing queued. Paste a link to add the next song.</p>
      ) : (
        <ol className="queue">
          {rows.map((row, index) => {
            const title = row.track?.title ?? "Unknown song";
            const owner = people[row.ownerId];
            const starPlace = starPlaces.get(row.entryId);
            return (
              <li
                key={row.entryId}
                className="row"
                style={{ "--owner": ownerColor(row.ownerId) } as React.CSSProperties}
              >
                <span className="row__n" aria-hidden="true">
                  {!shuffle ? (
                    index + 1
                  ) : starPlace === undefined ? null : (
                    <span className="row__star">
                      <Icon name="star-filled" />
                      {starPlace}
                    </span>
                  )}
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
                  {shuffle ? (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Play ${title} next`}
                      aria-pressed={starPlace !== undefined}
                      title={starPlace === undefined ? "Play next" : "Unstar"}
                      onClick={() => onStar(row.entryId, starPlace === undefined)}
                    >
                      <Icon name={starPlace === undefined ? "star" : "star-filled"} />
                    </button>
                  ) : (
                    <>
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
                    </>
                  )}
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
});
