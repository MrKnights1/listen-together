import type { IdGenerator } from "@/shared/domain/IdGenerator.ts";
import type { SkippedSong, TrackSource } from "@/modules/room/domain/ports/TrackSource.ts";
import type { RoomEngine } from "./RoomEngine.ts";

/** What pasting one link did, for the person who pasted it. */
export interface AddReport {
  added: number;
  /** Already in their list, or playing right now. */
  duplicates: number;
  /** Left out because their list or the room was full. */
  overflow: number;
  /** In the link but not playable here, with the reason for each. */
  skipped: SkippedSong[];
  /** The playlist was longer than one paste may add. */
  truncated: boolean;
}

/**
 * Turns a pasted link into songs in the person's own list. The link is
 * resolved before the room is touched, so a slow YouTube never holds up
 * anybody else's pause or skip.
 */
export class AddFromLink {
  constructor(
    private readonly trackSource: TrackSource,
    private readonly engine: RoomEngine,
    private readonly ids: IdGenerator,
  ) {}

  async execute(actorId: string, pasted: string): Promise<AddReport> {
    const resolved = await this.trackSource.resolve(pasted);

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
    return {
      added: outcome?.added.length ?? 0,
      duplicates: outcome?.duplicates.length ?? 0,
      overflow: outcome?.overflow ?? 0,
      skipped: resolved.skipped,
      truncated: resolved.truncated,
    };
  }
}
