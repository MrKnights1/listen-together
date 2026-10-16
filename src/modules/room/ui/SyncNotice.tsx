import type { SyncStatus } from "@/modules/player/ui/index.ts";
import { presenceLine } from "./wording.ts";

export function SyncNotice({
  listening,
  status,
  errorCode,
  onResync,
}: {
  listening: boolean;
  status: SyncStatus;
  errorCode: number | null;
  onResync: () => void;
}) {
  if (!listening) return null;
  return (
    <p className={`sync sync--${status}`} role="status">
      <span className="sync__dot" aria-hidden="true" />
      {presenceLine(true, status, errorCode)}
      {(status === "out_of_sync" || status === "error") && (
        <button type="button" className="link-button" onClick={onResync}>
          Try again
        </button>
      )}
    </p>
  );
}
