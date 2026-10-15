import type {
  AddResult,
  ClientMessage,
  CommandOp,
  NackCode,
  ServerMessage,
  SyncStatus,
} from "@/modules/room/contract/messages.ts";
import {
  NOT_ALLOWED_CLOSE_CODE,
  SESSION_ENDED_CLOSE_CODE,
} from "@/modules/room/contract/closeCodes.ts";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "signed_out" | "not_allowed";

export type CommandOutcome =
  { ok: true; result: AddResult | null } | { ok: false; code: NackCode | "disconnected" };

/** Just enough of the browser's WebSocket that tests need no real one. */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
}

export interface RoomConnectionDependencies {
  open: () => SocketLike;
  /** Local monotonic time. */
  now: () => number;
  /** Runs `run` after `ms`; returns the function that cancels it. */
  schedule: (ms: number, run: () => void) => () => void;
  onMessage: (message: ServerMessage) => void;
  onPong: (sentAt: number, receivedAt: number, serverTime: number) => void;
  onState: (state: ConnectionState) => void;
}

/** Waits between reconnects: quick at first, then backing off so a down server is not hammered. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000];
/** Five quick pings to line up the clock on connect, then one a minute to keep it — and the socket — alive. */
const PING_BURST = 5;
const PING_BURST_GAP_MS = 300;
const PING_EVERY_MS = 60_000;
/**
 * Adding a playlist waits on YouTube: a 5000-song one took 44 s against the
 * real API with nothing cached. Anything longer than this has gone wrong.
 */
const COMMAND_TIMEOUT_MS = 120_000;

type Presence = { listening: boolean; sync: SyncStatus; errorCode: number | null };

/**
 * The page's line to the room: one WebSocket, reopened when it drops, with
 * clock pings, commands matched to their answers, and this listener's
 * presence re-announced after every reconnect. Signed out or taken off the
 * guest list, it stops for good — reconnecting cannot fix either.
 */
export class RoomConnection {
  private socket: SocketLike | null = null;
  /** A browser WebSocket throws if written to before it opens, so nothing is sent until then. */
  private opened = false;
  private attempt = 0;
  private nextCommand = 0;
  private nextPing = 0;
  private readonly pings = new Map<number, number>();
  private readonly commands = new Map<
    string,
    { settle: (outcome: CommandOutcome) => void; cancel: () => void }
  >();
  private timers: (() => void)[] = [];
  private presence: Presence | null = null;
  private stopped = false;

  constructor(private readonly deps: RoomConnectionDependencies) {}

  start(): void {
    this.stopped = false;
    this.connect("connecting");
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000, "Leaving the room.");
    this.socket = null;
    this.opened = false;
    this.settleAll();
  }

  command(op: CommandOp): Promise<CommandOutcome> {
    if (!this.opened) return Promise.resolve({ ok: false, code: "disconnected" });

    this.nextCommand += 1;
    const id = `c${this.nextCommand}`;
    return new Promise((resolve) => {
      const cancel = this.deps.schedule(COMMAND_TIMEOUT_MS, () => {
        this.commands.delete(id);
        resolve({ ok: false, code: "disconnected" });
      });
      this.commands.set(id, { settle: resolve, cancel });
      this.send({ t: "cmd", id, op });
    });
  }

  /** Tells the room how this listener is doing — only when that changed. */
  setPresence(next: Presence): void {
    const same =
      this.presence !== null &&
      this.presence.listening === next.listening &&
      this.presence.sync === next.sync &&
      this.presence.errorCode === next.errorCode;
    this.presence = next;
    if (!same) this.send({ t: "presence", ...next });
  }

  /** Asks for the whole room again, after a missed update. */
  resync(): void {
    this.send({ t: "resync" });
  }

  /** The tab came back into view: a sleeping laptop's clock may have wandered. */
  wake(): void {
    this.pingBurst();
  }

  private connect(state: ConnectionState): void {
    if (this.stopped) return;
    this.deps.onState(state);

    const socket = this.deps.open();
    this.socket = socket;
    this.opened = false;
    socket.onopen = () => {
      this.opened = true;
      this.pingBurst();
    };
    socket.onmessage = (event) => this.received(event.data);
    socket.onclose = (event) => this.closed(socket, event.code);
  }

  private received(data: unknown): void {
    if (typeof data !== "string") return;
    let message: ServerMessage;
    try {
      message = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }

    switch (message.t) {
      case "pong": {
        const sentAt = this.pings.get(message.id);
        if (sentAt === undefined) return;
        this.pings.delete(message.id);
        this.deps.onPong(sentAt, this.deps.now(), message.s);
        return;
      }
      case "ack":
      case "nack": {
        const pending = this.commands.get(message.id);
        if (pending === undefined) return;
        this.commands.delete(message.id);
        pending.cancel();
        pending.settle(
          message.t === "ack"
            ? { ok: true, result: message.result }
            : { ok: false, code: message.code },
        );
        return;
      }
      case "welcome":
        this.attempt = 0;
        this.deps.onState("open");
        this.deps.onMessage(message);
        if (this.presence !== null) this.send({ t: "presence", ...this.presence });
        return;
      default:
        this.deps.onMessage(message);
    }
  }

  private closed(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.opened = false;
    this.clearTimers();
    this.settleAll();
    this.pings.clear();
    if (this.stopped) return;

    if (code === SESSION_ENDED_CLOSE_CODE) return this.deps.onState("signed_out");
    if (code === NOT_ALLOWED_CLOSE_CODE) return this.deps.onState("not_allowed");

    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 30_000;
    this.attempt += 1;
    this.deps.onState("reconnecting");
    this.timers.push(this.deps.schedule(delay, () => this.connect("reconnecting")));
  }

  private pingBurst(): void {
    for (let index = 0; index < PING_BURST; index += 1) {
      this.timers.push(this.deps.schedule(index * PING_BURST_GAP_MS, () => this.ping()));
    }
    this.timers.push(this.deps.schedule(PING_EVERY_MS, () => this.keepPinging()));
  }

  private keepPinging(): void {
    this.ping();
    this.timers.push(this.deps.schedule(PING_EVERY_MS, () => this.keepPinging()));
  }

  private ping(): void {
    this.nextPing += 1;
    const sentAt = this.deps.now();
    this.pings.set(this.nextPing, sentAt);
    this.send({ t: "ping", id: this.nextPing, c: sentAt });
  }

  private send(message: ClientMessage): void {
    if (this.opened) this.socket?.send(JSON.stringify(message));
  }

  private settleAll(): void {
    for (const pending of this.commands.values()) {
      pending.cancel();
      pending.settle({ ok: false, code: "disconnected" });
    }
    this.commands.clear();
  }

  private clearTimers(): void {
    for (const cancel of this.timers) cancel();
    this.timers = [];
  }
}
