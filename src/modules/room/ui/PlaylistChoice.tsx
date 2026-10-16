import type { LinkScope } from "@/modules/room/domain/ports/TrackSource.ts";

/** Asked when a pasted link names a song inside a playlist: which of the two was meant. */
export function PlaylistChoice({ onChoose }: { onChoose: (scope: LinkScope) => void }) {
  return (
    <div className="add__choice">
      <p>This song is part of a playlist.</p>
      <div className="add__choices">
        <button type="button" className="button" onClick={() => onChoose("song")}>
          Just this song
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => onChoose("playlist")}
        >
          Playlist from this song on
        </button>
      </div>
    </div>
  );
}
