import { Icon } from "@/shared/ui/Icon.tsx";
import type { ConnectionState } from "./RoomConnection.ts";

const CONNECTION_TEXT: Partial<Record<ConnectionState, string>> = {
  connecting: "Joining the room…",
  reconnecting: "Lost the connection. Reconnecting…",
};

export function ConnectionBanner({ state }: { state: ConnectionState }) {
  const text = CONNECTION_TEXT[state];
  return (
    <p className="banner" role="status" hidden={text === undefined}>
      <Icon name="spinner" className="banner__spinner" />
      {text}
    </p>
  );
}
