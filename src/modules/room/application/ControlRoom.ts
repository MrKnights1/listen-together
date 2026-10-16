import type { RoomCommand } from "@/modules/room/domain/commands.ts";
import type { Decision } from "@/modules/room/domain/decide.ts";
import type { RoomEngine } from "./RoomEngine.ts";

/** The commands a person may send. Adding has its own use case; the rest belong to the room's timers. */
export type PersonCommand = Extract<
  RoomCommand,
  {
    type:
      | "pause"
      | "resume"
      | "seek"
      | "skip"
      | "remove"
      | "move"
      | "clear"
      | "shuffle"
      | "repeat"
      | "set_shuffle";
  }
>;

const PERSON_COMMANDS = new Set<RoomCommand["type"]>([
  "pause",
  "resume",
  "seek",
  "skip",
  "remove",
  "move",
  "clear",
  "shuffle",
  "repeat",
  "set_shuffle",
]);

/** Everyone in the room may pause, skip, seek and rearrange for everyone. */
export class ControlRoom {
  constructor(private readonly engine: RoomEngine) {}

  async execute(actorId: string, command: PersonCommand): Promise<Decision> {
    // The type already says so; this is the line a malformed message cannot cross.
    if (!PERSON_COMMANDS.has(command.type)) return { kind: "rejected", code: "invalid" };
    return await this.engine.execute(command, actorId, []);
  }
}
