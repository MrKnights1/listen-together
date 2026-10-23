import { memo } from "react";
import type { Person } from "@/modules/room/contract/messages.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { Icon } from "@/shared/ui/Icon.tsx";
import { OwnerChip } from "./OwnerChip.tsx";
import { ownerColor } from "./ownerColor.ts";
import { formatDuration } from "./wording.ts";

/**
 * One queued song. Memoised on props that keep their identity while nothing
 * about the row changed: a pause or a presence update redraws no row at all.
 */
export const UpNextRow = memo(function UpNextRow({
  entryId,
  ownerId,
  owner,
  track,
  durationMs,
  first,
  last,
  shuffle,
  starPlace,
  onMove,
  onStar,
  onRemove,
}: {
  entryId: string;
  ownerId: string;
  owner: Person | undefined;
  track: TrackInfo | undefined;
  durationMs: number;
  /**
   * Only the ends, not its place: a place would change for every row each time
   * a song starts. The list numbers the rows itself.
   */
  first: boolean;
  last: boolean;
  shuffle: boolean;
  /** Its place in the starred line, from 1, or undefined when not starred. */
  starPlace: number | undefined;
  /** One place earlier (-1) or later (1). */
  onMove: (entryId: string, by: -1 | 1) => void;
  onStar: (entryId: string, on: boolean) => void;
  onRemove: (entryId: string) => void;
}) {
  const title = track?.title ?? "Unknown song";
  return (
    <li className="row" style={{ "--owner": ownerColor(ownerId) } as React.CSSProperties}>
      <span className="row__n" aria-hidden="true">
        {shuffle && starPlace !== undefined && (
          <span className="row__star">
            <Icon name="star-filled" />
            {starPlace}
          </span>
        )}
      </span>
      {track?.artworkUrl ? (
        <img
          className="row__art"
          src={track.artworkUrl}
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
        {track !== undefined && <span className="row__artist">{track.artist}</span>}
      </span>
      <span className="row__meta">
        <OwnerChip ownerId={ownerId} person={owner} />
        <span className="row__len">{formatDuration(durationMs)}</span>
      </span>
      <span className="row__actions">
        {shuffle ? (
          <button
            type="button"
            className="icon-button"
            aria-label={`Play ${title} next`}
            aria-pressed={starPlace !== undefined}
            title={starPlace === undefined ? "Play next" : "Unstar"}
            onClick={() => onStar(entryId, starPlace === undefined)}
          >
            <Icon name={starPlace === undefined ? "star" : "star-filled"} />
          </button>
        ) : (
          <>
            <button
              type="button"
              className="icon-button"
              disabled={first}
              aria-label={`Move ${title} earlier in the queue`}
              title="Move earlier"
              onClick={() => onMove(entryId, -1)}
            >
              <Icon name="up" />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={last}
              aria-label={`Move ${title} later in the queue`}
              title="Move later"
              onClick={() => onMove(entryId, 1)}
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
          onClick={() => onRemove(entryId)}
        >
          <Icon name="remove" />
        </button>
      </span>
    </li>
  );
});
