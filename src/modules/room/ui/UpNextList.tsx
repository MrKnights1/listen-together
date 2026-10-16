import { memo, useState } from "react";
import type { Person } from "@/modules/room/contract/messages.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog.tsx";
import { Icon } from "@/shared/ui/Icon.tsx";
import { OwnerChip } from "./OwnerChip.tsx";
import { ownerColor } from "./ownerColor.ts";
import { clearQuestion, formatDuration } from "./wording.ts";

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

/**
 * Memoised: the page re-renders twice a second to move the clock, and a full
 * room is 5000 rows. The list only re-renders when the queue or people change.
 */
export const UpNextList = memo(function UpNextList({
  rows,
  shuffle,
  people,
  you,
  onMove,
  onRemove,
  onShuffleMine,
  onClear,
}: {
  rows: QueueRow[];
  /** While on, the list is a pool to draw from, not a running order: it drops its numbers. */
  shuffle: boolean;
  people: Record<string, Person>;
  you: string | null;
  onMove: (entryId: string, toIndex: number) => void;
  onRemove: (entryId: string) => void;
  onShuffleMine: () => void;
  /** Clears every queued song added up to `addedUpTo`, once the person has said yes. */
  onClear: (addedUpTo: number) => void;
}) {
  const [clearing, setClearing] = useState<ClearRequest | null>(null);
  const mine = rows.filter((row) => row.ownerId === you).length;
  return (
    <section className="upnext" aria-labelledby="upnext-heading" id="upnext">
      <div className="upnext__head">
        <h2 id="upnext-heading">Up next</h2>
        <div className="upnext__actions">
          <button
            type="button"
            className="button button--small"
            disabled={mine < 2}
            onClick={onShuffleMine}
          >
            <Icon name="shuffle" />
            Shuffle my songs
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
      <p className="upnext__note">
        {shuffle
          ? "Shuffle is on: each next song is picked at random."
          : "Songs play in the order they were added."}
      </p>
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
                  {shuffle ? null : index + 1}
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
});
