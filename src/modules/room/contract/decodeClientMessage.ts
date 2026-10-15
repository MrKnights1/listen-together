import {
  MAX_ID_LENGTH,
  MAX_MESSAGE_BYTES,
  MAX_POSITION_MS,
  MAX_URL_LENGTH,
  type ClientMessage,
  type CommandOp,
  type SyncStatus,
} from "./messages.ts";
import type { LinkScope } from "@/modules/room/domain/ports/TrackSource.ts";

const SYNC_STATUSES = new Set<SyncStatus>([
  "idle",
  "in_sync",
  "catching_up",
  "out_of_sync",
  "error",
]);
const REPEAT_MODES = new Set(["off", "one", "all"]);
const LINK_SCOPES = new Set(["song", "playlist"]);
const ENTRY_COMMANDS = new Set(["pause", "resume", "skip", "remove"]);
/** Ids are ours (UUIDs) or the client's own (command ids): printable, no spaces, bounded. */
const ID = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_ID_LENGTH}}$`);

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Exactly these keys and no others: an unexpected field is a client this server does not know. */
const hasOnly = (value: Fields, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

const isWholeNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function decodeOp(op: unknown): CommandOp | null {
  if (!isRecord(op) || typeof op["type"] !== "string") return null;
  const type = op["type"];

  if (type === "add") {
    const { url, scope } = op;
    return hasOnly(op, ["type", "url", "scope"]) &&
      typeof url === "string" &&
      url.length <= MAX_URL_LENGTH &&
      typeof scope === "string" &&
      LINK_SCOPES.has(scope)
      ? { type, url, scope: scope as LinkScope }
      : null;
  }
  if (ENTRY_COMMANDS.has(type)) {
    return hasOnly(op, ["type", "entryId"]) && isId(op["entryId"])
      ? { type: type as "pause" | "resume" | "skip" | "remove", entryId: op["entryId"] }
      : null;
  }
  if (type === "seek") {
    return hasOnly(op, ["type", "entryId", "positionMs"]) &&
      isId(op["entryId"]) &&
      isWholeNumber(op["positionMs"], 0, MAX_POSITION_MS)
      ? { type, entryId: op["entryId"], positionMs: op["positionMs"] }
      : null;
  }
  if (type === "move") {
    return hasOnly(op, ["type", "entryId", "toIndex"]) &&
      isId(op["entryId"]) &&
      isWholeNumber(op["toIndex"], 0, 10_000)
      ? { type, entryId: op["entryId"], toIndex: op["toIndex"] }
      : null;
  }
  if (type === "shuffle") {
    const ownerId = op["ownerId"];
    return hasOnly(op, ["type", "ownerId"]) && isId(ownerId) ? { type, ownerId } : null;
  }
  if (type === "set_shuffle") {
    const on = op["on"];
    return hasOnly(op, ["type", "on"]) && typeof on === "boolean" ? { type, on } : null;
  }
  if (type === "repeat") {
    const mode = op["mode"];
    return hasOnly(op, ["type", "mode"]) && typeof mode === "string" && REPEAT_MODES.has(mode)
      ? { type, mode: mode as "off" | "one" | "all" }
      : null;
  }
  return null;
}

/**
 * Reads one message from a browser, or null. Everything arriving here is
 * attacker-reachable, so this is strict: the exact fields, the exact types,
 * bounded sizes. A null is answered with a refusal, never a crash.
 */
export function decodeClientMessage(raw: string | Uint8Array): ClientMessage | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_MESSAGE_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  switch (value["t"]) {
    case "ping":
      return hasOnly(value, ["t", "id", "c"]) &&
        isWholeNumber(value["id"], 0, Number.MAX_SAFE_INTEGER) &&
        typeof value["c"] === "number" &&
        Number.isFinite(value["c"])
        ? { t: "ping", id: value["id"], c: value["c"] }
        : null;

    case "cmd": {
      if (!hasOnly(value, ["t", "id", "op"]) || !isId(value["id"])) return null;
      const op = decodeOp(value["op"]);
      return op === null ? null : { t: "cmd", id: value["id"], op };
    }

    case "resync":
      return hasOnly(value, ["t"]) ? { t: "resync" } : null;

    case "presence": {
      const sync = value["sync"];
      const errorCode = value["errorCode"];
      return hasOnly(value, ["t", "listening", "sync", "errorCode"]) &&
        typeof value["listening"] === "boolean" &&
        typeof sync === "string" &&
        SYNC_STATUSES.has(sync as SyncStatus) &&
        (errorCode === null || isWholeNumber(errorCode, 0, 999))
        ? { t: "presence", listening: value["listening"], sync: sync as SyncStatus, errorCode }
        : null;
    }

    default:
      return null;
  }
}
