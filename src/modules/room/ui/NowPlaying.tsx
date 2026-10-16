import type { Person } from "@/modules/room/contract/messages.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { OwnerChip } from "./OwnerChip.tsx";

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
