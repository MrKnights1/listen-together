import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Person } from "@/modules/room/contract/messages.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog.tsx";
import { Icon } from "@/shared/ui/Icon.tsx";
import { UpNextRow } from "./UpNextRow.tsx";
import { clearQuestion, songs } from "./wording.ts";

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
 * Memoised, and so is each row: a full room is 5000 rows. Pausing, seeking or
 * a listener's status changing redraws none of them; a starred song redraws
 * only the rows whose place changed.
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
  // Read when a move is clicked, so no row has to carry its place in the line.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const moveBy = useCallback(
    (entryId: string, by: -1 | 1) => {
      const at = rowsRef.current.findIndex((row) => row.entryId === entryId);
      if (at !== -1) onMove(entryId, at + by);
    },
    [onMove],
  );
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
        <ol className={shuffle ? "queue" : "queue queue--numbered"}>
          {rows.map((row, index) => (
            <UpNextRow
              key={row.entryId}
              entryId={row.entryId}
              ownerId={row.ownerId}
              owner={people[row.ownerId]}
              track={row.track}
              durationMs={row.durationMs}
              first={index === 0}
              last={index === rows.length - 1}
              shuffle={shuffle}
              starPlace={starPlaces.get(row.entryId)}
              onMove={moveBy}
              onStar={onStar}
              onRemove={onRemove}
            />
          ))}
        </ol>
      )}
    </section>
  );
});
