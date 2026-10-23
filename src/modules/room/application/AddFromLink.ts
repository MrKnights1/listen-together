import type { IdGenerator } from "@/shared/domain/IdGenerator.ts";
import type { PasteLog } from "@/modules/room/domain/ports/PasteLog.ts";
import { pasteAllowance } from "@/modules/room/domain/RoomState.ts";
import type {
  LinkScope,
  SkippedSong,
  TrackSource,
} from "@/modules/room/domain/ports/TrackSource.ts";
import type { RoomEngine } from "./RoomEngine.ts";

/** What pasting one link did, for the person who pasted it. */
export interface AddReport {
  added: number;
  /** Already in their list, or playing right now. */
  duplicates: number;
  /** Left out because the room was full. */
  overflow: number;
  /** In the link but not playable here, with the reason for each. */
  skipped: SkippedSong[];
  /** The room could not take the rest of the playlist, so it was not read. */
  truncated: boolean;
}

/**
 * Turns a pasted link into songs in the person's own list. The link is
 * resolved before the room is touched, so a slow YouTube never holds up
 * anybody else's pause or skip — and only as far as the room, as it is when
 * the paste starts, could take.
 */
export class AddFromLink {
  constructor(
    private readonly trackSource: TrackSource,
    private readonly engine: RoomEngine,
    private readonly ids: IdGenerator,
    private readonly pastes: PasteLog,
  ) {}

  async execute(actorId: string, pasted: string, scope: LinkScope): Promise<AddReport> {
    const allowance = pasteAllowance(this.engine.snapshot().state, actorId);
    const resolved = await this.trackSource.resolve(pasted, scope, allowance);

    const decision = await this.engine.execute(
      {
        type: "add",
        ownerId: actorId,
        tracks: resolved.tracks.map((track) => ({
          entryId: this.ids.newId(),
          trackId: track.trackId,
          durationMs: track.durationMs,
        })),
      },
      actorId,
      resolved.tracks,
    );

    // `add` is never rejected: it reports what it could not take instead.
    const outcome = decision.kind === "accepted" ? decision.add : undefined;
    const report: AddReport = {
      added: outcome?.added.length ?? 0,
      duplicates: outcome?.duplicates.length ?? 0,
      overflow: outcome?.overflow ?? 0,
      skipped: resolved.skipped,
      truncated: resolved.truncated,
    };
    this.pastes.record({ actorId, pasted, scope, added: report.added });
    return report;
  }
}
