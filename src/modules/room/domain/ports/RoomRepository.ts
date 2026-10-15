import type { RoomState } from "@/modules/room/domain/RoomState.ts";

export interface StoredRoom {
  state: RoomState;
  /** When it was saved: the instant its clock was last known to be right. */
  savedAt: number;
  /** True only if the server stopped on purpose and saved on the way out. */
  cleanShutdown: boolean;
}

/** The one room, saved whole after every change so a restart can pick it up. */
export interface RoomRepository {
  load(): Promise<StoredRoom | null>;
  save(state: RoomState, savedAt: number, cleanShutdown: boolean): Promise<void>;
}
