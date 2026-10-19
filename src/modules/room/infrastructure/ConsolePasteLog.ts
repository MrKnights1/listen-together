import type { Paste, PasteLog } from "@/modules/room/domain/ports/PasteLog.ts";

/** Pastes on stdout, which systemd keeps in the server's journal. */
export class ConsolePasteLog implements PasteLog {
  record(paste: Paste): void {
    // As JSON, so a pasted newline is written as \n and cannot start a forged line of its own.
    console.info("Link pasted", JSON.stringify(paste));
  }
}
