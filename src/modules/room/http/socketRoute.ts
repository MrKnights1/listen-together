import { contained } from "@/shared/http/contained.ts";
import { badRequest } from "@/shared/http/httpErrors.ts";
import { requireSession, type GetSessionUser } from "@/modules/identity/index.ts";
import type { RoomSocketData } from "./RoomSockets.ts";

export interface RoomSocketRouteDependencies {
  getSessionUser: GetSessionUser;
  /** The app's own origin. A handshake from anywhere else is refused. */
  allowedOrigin: string;
}

/** The part of Bun's server the upgrade needs. */
export interface Upgrader {
  upgrade(request: Request, options: { data: RoomSocketData }): boolean;
}

/**
 * `GET /api/room/socket` — open the room's live connection.
 *
 * The Origin must be present and exactly ours. `SameSite=Lax` already keeps the
 * session cookie off a cross-site handshake; this is the check that does not
 * depend on that staying true. Everything the socket is allowed to know about
 * who it belongs to is fixed here, from the verified session.
 */
export function createRoomSocketRoute(deps: RoomSocketRouteDependencies) {
  return contained(
    "Opening a room socket",
    async (request: Request, server: Upgrader): Promise<Response | undefined> => {
      if (request.headers.get("origin") !== deps.allowedOrigin) {
        return badRequest("That origin may not open the room.");
      }

      const session = await requireSession(request, deps.getSessionUser);
      if ("response" in session) return session.response;

      const upgraded = server.upgrade(request, {
        data: {
          connId: crypto.randomUUID(),
          userId: session.user.id,
          sessionToken: session.sessionToken,
          expiresAt: session.expiresAt.getTime(),
        },
      });
      return upgraded ? undefined : badRequest("This endpoint speaks WebSocket.");
    },
  );
}
