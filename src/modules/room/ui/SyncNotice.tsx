import type { SyncStatus } from "@/modules/player/ui/index.ts";
import { playerProblem, presenceLine } from "./wording.ts";

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
  const problem = status === "error" ? playerProblem(errorCode) : null;
  const retry = problem?.retry ?? (status === "out_of_sync" || status === "no_player");
  return (
    <p
      className={`sync sync--${status}`}
      role="status"
      // The raw code, for whoever is asked to look into it; nobody needs to read it.
      title={problem !== null && errorCode !== null ? `YouTube error ${errorCode}` : undefined}
    >
      <span className="sync__dot" aria-hidden="true" />
      <span className="sync__line">{presenceLine(true, status, errorCode)}</span>
      {problem !== null && <span className="sync__help">{problem.help}</span>}
      {retry && (
        <button type="button" className="link-button" onClick={onResync}>
          Try again
        </button>
      )}
    </p>
  );
}
