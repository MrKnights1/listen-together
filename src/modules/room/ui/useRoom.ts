import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ClockSync } from "@/modules/player/ui/index.ts";
import type { CommandOp, SyncStatus } from "@/modules/room/contract/messages.ts";
import { emptyClientRoom, receive, type ClientRoom } from "./clientRoom.ts";
import {
  RoomConnection,
  type CommandOutcome,
  type ConnectionState,
  type SocketLike,
} from "./RoomConnection.ts";

export interface RoomHandle {
  room: ClientRoom;
  connection: ConnectionState;
  clock: ClockSync;
  command: (op: CommandOp) => Promise<CommandOutcome>;
  setPresence: (presence: {
    listening: boolean;
    sync: SyncStatus;
    errorCode: number | null;
  }) => void;
}

function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/room/socket`;
}

/** The browser's WebSocket, behind the narrow shape the connection is written against. */
function openSocket(): SocketLike {
  const ws = new WebSocket(socketUrl());
  const socket: SocketLike = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data });
  ws.onclose = (event) => socket.onclose?.({ code: event.code });
  return socket;
}

/** The page's live copy of the room, and the line it travels over. */
export function useRoom(): RoomHandle {
  const [room, dispatch] = useReducer(receive, undefined, emptyClientRoom);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const clockRef = useRef(new ClockSync());
  const connectionRef = useRef<RoomConnection | null>(null);

  useEffect(() => {
    const live = new RoomConnection({
      open: openSocket,
      now: () => performance.now(),
      schedule: (ms, run) => {
        const handle = setTimeout(run, ms);
        return () => clearTimeout(handle);
      },
      onMessage: dispatch,
      onPong: (sentAt, receivedAt, serverTime) =>
        clockRef.current.record(sentAt, receivedAt, serverTime),
      onState: (state) => {
        // A new connection may be a new server process: its clock is measured afresh.
        if (state === "reconnecting") clockRef.current.reset();
        setConnection(state);
      },
    });
    connectionRef.current = live;
    live.start();

    const onVisible = () => {
      if (document.visibilityState === "visible") live.wake();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      live.stop();
      connectionRef.current = null;
    };
  }, []);

  // Missed an update: ask for the whole room rather than guess.
  useEffect(() => {
    if (room.behind) connectionRef.current?.resync();
  }, [room.behind]);

  const command = useCallback(
    (op: CommandOp) =>
      connectionRef.current?.command(op) ??
      Promise.resolve<CommandOutcome>({ ok: false, code: "disconnected" }),
    [],
  );
  const setPresence = useCallback<RoomHandle["setPresence"]>(
    (presence) => connectionRef.current?.setPresence(presence),
    [],
  );

  return { room, connection, clock: clockRef.current, command, setPresence };
}
