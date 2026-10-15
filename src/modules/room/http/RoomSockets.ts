import type { Clock } from "@/shared/domain/Clock.ts";
import type { Timers } from "@/shared/domain/Timers.ts";
import {
  NOT_ALLOWED_CLOSE_CODE,
  SESSION_ENDED_CLOSE_CODE,
} from "@/modules/room/contract/closeCodes.ts";
import type { AddFromLink } from "@/modules/room/application/AddFromLink.ts";
import type { ControlRoom } from "@/modules/room/application/ControlRoom.ts";
import type { DescribePeople } from "@/modules/room/application/DescribePeople.ts";
import type { GetRoomView } from "@/modules/room/application/GetRoomView.ts";
import type { PauseEmptyRoom } from "@/modules/room/application/PauseEmptyRoom.ts";
import type { RoomEngine, RoomUpdate } from "@/modules/room/application/RoomEngine.ts";
import { decodeClientMessage } from "@/modules/room/contract/decodeClientMessage.ts";
import {
  MAX_MESSAGE_BYTES,
  type ClientMessage,
  type CommandOp,
  type ListenerView,
  type NackCode,
  type ServerMessage,
  type SyncStatus,
} from "@/modules/room/contract/messages.ts";
import { LinkRejected } from "@/modules/room/domain/errors.ts";
import { PersonLimits } from "./rateLimits.ts";

/** Set at upgrade from the verified session, never from a message. */
export interface RoomSocketData {
  connId: string;
  userId: string;
  /** Kept to re-check the session on every command. In memory only: never logged or sent. */
  sessionToken: string;
  expiresAt: number;
}

/**
 * The one question this layer asks about a session, in the shape identity's
 * `GetSessionUser` answers it — narrowed to what is used, so nothing here
 * depends on how identity models a person.
 */
export interface SessionChecker {
  execute(
    sessionToken: string | null,
  ): Promise<
    | { status: "signed_in"; user: { id: string } }
    | { status: "signed_out" }
    | { status: "not_allowed" }
  >;
}

/** Just enough of Bun's socket that the tests need no real one. */
export interface RoomSocket {
  data: RoomSocketData;
  send(message: string): unknown;
  close(code?: number, reason?: string): void;
}

export interface RoomSocketsDependencies {
  getSessionUser: SessionChecker;
  engine: RoomEngine;
  addFromLink: AddFromLink;
  controlRoom: ControlRoom;
  getRoomView: GetRoomView;
  describePeople: DescribePeople;
  pauseEmptyRoom: PauseEmptyRoom;
  clock: Clock;
  timers: Timers;
}

interface Connection {
  ws: RoomSocket;
  /** False until the welcome is sent: nothing may arrive before the room it applies to. */
  ready: boolean;
  listening: boolean;
  sync: SyncStatus;
  errorCode: number | null;
}

/**
 * Everyone connected to the room. One socket per tab; the room's changes go
 * out to all of them, and their commands come in here.
 *
 * A socket outlives the request that opened it, so the session is not just
 * checked at the door: every command asks again, signing out closes the
 * person's sockets at once, and one timer closes each socket when its session
 * expires.
 */
export class RoomSockets {
  private readonly connections = new Map<string, Connection>();
  /** People with a link being resolved right now: one at a time each. */
  private readonly resolving = new Set<string>();
  private readonly limits: PersonLimits;
  private cancelExpiry: (() => void) | null = null;

  constructor(private readonly deps: RoomSocketsDependencies) {
    this.limits = new PersonLimits(deps.clock);
    deps.engine.subscribe((update) => this.broadcast(eventMessage(update)));
  }

  /** The object `Bun.serve` takes as its `websocket` option. */
  readonly handler = {
    // Clients ping once a minute; two minutes of silence is a dead connection.
    idleTimeout: 120,
    sendPings: true,
    maxPayloadLength: MAX_MESSAGE_BYTES,
    // Messages are tiny, and every compression context is memory held per socket.
    perMessageDeflate: false,
    // A tab that cannot keep up is better dropped than buffered without end; it resyncs on reconnect.
    closeOnBackpressureLimit: true,

    open: (ws: RoomSocket) => this.opened(ws),
    message: (ws: RoomSocket, raw: string | Buffer) => this.received(ws, raw),
    close: (ws: RoomSocket) => this.closed(ws),
  };

  get count(): number {
    return this.connections.size;
  }

  /** Signed out: every socket that session opened closes now. */
  closeForSession(sessionToken: string): number {
    return this.closeWhere(
      (connection) => connection.ws.data.sessionToken === sessionToken,
      SESSION_ENDED_CLOSE_CODE,
      "You signed out.",
    );
  }

  /** Shutdown: everybody reconnects to whichever process comes next. */
  closeAll(code: number, reason: string): number {
    return this.closeWhere(() => true, code, reason);
  }

  private async opened(ws: RoomSocket): Promise<void> {
    const connection: Connection = {
      ws,
      ready: false,
      listening: false,
      sync: "idle",
      errorCode: null,
    };
    this.connections.set(ws.data.connId, connection);
    this.deps.pauseEmptyRoom.listenersChanged(this.connections.size);
    this.rearmExpiry();

    try {
      const room = await this.deps.getRoomView.execute(this.connectedPeople());
      if (!this.connections.has(ws.data.connId)) return;
      this.send(ws, {
        t: "welcome",
        s: this.now(),
        you: ws.data.userId,
        room,
        listeners: this.listenerViews(),
      });
      // Same synchronous step as the snapshot inside the view: no update can fall between.
      connection.ready = true;
    } catch (error) {
      console.error("Welcoming a listener failed", error);
      ws.close(1011, "The room could not be loaded.");
      return;
    }

    await this.broadcastListeners();
  }

  private async closed(ws: RoomSocket): Promise<void> {
    if (!this.connections.delete(ws.data.connId)) return;
    if (![...this.connections.values()].some((one) => one.ws.data.userId === ws.data.userId)) {
      this.limits.forget(ws.data.userId);
    }
    this.deps.pauseEmptyRoom.listenersChanged(this.connections.size);
    this.rearmExpiry();
    await this.broadcastListeners();
  }

  private async received(ws: RoomSocket, raw: string | Buffer): Promise<void> {
    const connection = this.connections.get(ws.data.connId);
    if (connection === undefined) return;

    const message = decodeClientMessage(typeof raw === "string" ? raw : new Uint8Array(raw));
    if (message === null) {
      this.send(ws, { t: "nack", id: "", code: "invalid" });
      return;
    }

    try {
      await this.handle(connection, message);
    } catch (error) {
      console.error("Handling a room message failed", error);
      if (message.t === "cmd") this.send(ws, { t: "nack", id: message.id, code: "unavailable" });
    }
  }

  private async handle(connection: Connection, message: ClientMessage): Promise<void> {
    const { ws } = connection;
    const userId = ws.data.userId;

    switch (message.t) {
      case "ping":
        if (this.limits.allow(userId, "ping")) {
          this.send(ws, { t: "pong", id: message.id, c: message.c, s: this.now() });
        }
        return;

      case "presence":
        if (!this.limits.allow(userId, "presence")) return;
        connection.listening = message.listening;
        connection.sync = message.sync;
        connection.errorCode = message.errorCode;
        await this.broadcastListeners();
        return;

      case "resync": {
        if (!this.limits.allow(userId, "command")) return;
        const room = await this.deps.getRoomView.execute(this.connectedPeople());
        this.send(ws, { t: "snapshot", s: this.now(), room, listeners: this.listenerViews() });
        return;
      }

      case "cmd":
        await this.command(connection, message.id, message.op);
        return;
    }
  }

  private async command(connection: Connection, id: string, op: CommandOp): Promise<void> {
    const { ws } = connection;
    const userId = ws.data.userId;
    const nack = (code: NackCode) => this.send(ws, { t: "nack", id, code });

    if (!this.limits.allow(userId, "command")) return nack("rate_limited");
    if (!(await this.stillAllowed(ws))) return;

    if (op.type !== "add") {
      const decision = await this.deps.controlRoom.execute(userId, op);
      if (decision.kind === "rejected") return nack(decision.code);
      this.send(ws, { t: "ack", id, result: null });
      return;
    }

    if (!this.limits.allow(userId, "add")) return nack("rate_limited");
    if (this.resolving.has(userId)) return nack("busy");

    this.resolving.add(userId);
    try {
      const result = await this.deps.addFromLink.execute(userId, op.url);
      this.send(ws, { t: "ack", id, result });
    } catch (error) {
      if (!(error instanceof LinkRejected)) throw error;
      nack(error.code);
    } finally {
      this.resolving.delete(userId);
    }
  }

  /** Re-checks the session behind a socket, closing it if it is no longer good. */
  private async stillAllowed(ws: RoomSocket): Promise<boolean> {
    const lookup = await this.deps.getSessionUser.execute(ws.data.sessionToken);

    if (lookup.status === "not_allowed") {
      this.closeWhere(
        (one) => one.ws === ws,
        NOT_ALLOWED_CLOSE_CODE,
        "No longer on the guest list.",
      );
      return false;
    }
    if (lookup.status === "signed_out" || lookup.user.id !== ws.data.userId) {
      this.closeWhere((one) => one.ws === ws, SESSION_ENDED_CLOSE_CODE, "Your session ended.");
      return false;
    }
    return true;
  }

  /** One timer for the soonest session expiry among open sockets. */
  private rearmExpiry(): void {
    this.cancelExpiry?.();
    this.cancelExpiry = null;

    let soonest = Infinity;
    for (const { ws } of this.connections.values()) soonest = Math.min(soonest, ws.data.expiresAt);
    if (soonest === Infinity) return;

    this.cancelExpiry = this.deps.timers.after(soonest - this.now(), () => {
      const now = this.now();
      this.closeWhere(
        (one) => one.ws.data.expiresAt <= now,
        SESSION_ENDED_CLOSE_CODE,
        "Your session expired.",
      );
      this.rearmExpiry();
    });
  }

  private closeWhere(
    match: (connection: Connection) => boolean,
    code: number,
    reason: string,
  ): number {
    let closed = 0;
    // A copy: closing a socket fires `close`, which edits the map being walked.
    for (const connection of [...this.connections.values()]) {
      if (!match(connection)) continue;
      connection.ws.close(code, reason);
      closed += 1;
    }
    return closed;
  }

  private connectedPeople(): string[] {
    return [...new Set([...this.connections.values()].map((one) => one.ws.data.userId))];
  }

  /** One line per person: listening if any of their tabs is, with that tab's sync. */
  private listenerViews(): ListenerView[] {
    const byUser = new Map<string, ListenerView>();
    for (const connection of this.connections.values()) {
      const userId = connection.ws.data.userId;
      const known = byUser.get(userId);
      if (known === undefined || (!known.listening && connection.listening)) {
        byUser.set(userId, {
          userId,
          listening: connection.listening,
          sync: connection.sync,
          errorCode: connection.errorCode,
        });
      }
    }
    return [...byUser.values()];
  }

  private async broadcastListeners(): Promise<void> {
    const people = await this.deps.describePeople.execute(this.connectedPeople());
    this.broadcast({ t: "listeners", listeners: this.listenerViews(), people });
  }

  private broadcast(message: ServerMessage): void {
    // Encoded once, however many are listening.
    const encoded = JSON.stringify(message);
    for (const connection of this.connections.values()) {
      if (connection.ready) connection.ws.send(encoded);
    }
  }

  private send(ws: RoomSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  private now(): number {
    return this.deps.clock.now().getTime();
  }
}

function eventMessage(update: RoomUpdate): ServerMessage {
  return {
    t: "ev",
    v: update.version,
    by: update.actorId,
    events: update.events,
    tracks: update.tracks,
    activity: update.activity,
  };
}
