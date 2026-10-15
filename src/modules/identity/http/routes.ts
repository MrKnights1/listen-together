import { addGuestHandler, type AddGuestDependencies } from "./handlers/addGuestHandler.ts";
import {
  declineRequestHandler,
  type DeclineRequestDependencies,
} from "./handlers/declineRequestHandler.ts";
import {
  discordCallbackHandler,
  type DiscordCallbackDependencies,
} from "./handlers/discordCallbackHandler.ts";
import { guestListHandler } from "./handlers/guestListHandler.ts";
import { logOutHandler, type LogOutDependencies } from "./handlers/logOutHandler.ts";
import { removeGuestHandler, type RemoveGuestDependencies } from "./handlers/removeGuestHandler.ts";
import {
  setGuestAdminHandler,
  type SetGuestAdminDependencies,
} from "./handlers/setGuestAdminHandler.ts";
import { sessionHandler, type SessionDependencies } from "./handlers/sessionHandler.ts";
import {
  startDiscordLoginHandler,
  type StartDiscordLoginDependencies,
} from "./handlers/startDiscordLoginHandler.ts";

/** Gathered from the handlers, so a handler that grows a dependency asks for it in its own file. */
export interface IdentityRouteDependencies
  extends
    StartDiscordLoginDependencies,
    DiscordCallbackDependencies,
    SessionDependencies,
    LogOutDependencies,
    AddGuestDependencies,
    RemoveGuestDependencies,
    SetGuestAdminDependencies,
    DeclineRequestDependencies {}

/** Which method on which path, and nothing else. One handler per file. */
export function createIdentityRoutes(deps: IdentityRouteDependencies) {
  return {
    "/api/auth/discord/start": { GET: startDiscordLoginHandler(deps) },
    "/api/auth/discord/callback": { GET: discordCallbackHandler(deps) },
    // Reading the session says who is signed in; deleting it signs them out.
    "/api/auth/session": { GET: sessionHandler(deps), DELETE: logOutHandler(deps) },
    // Admins only: who may join the room, and who else may decide that.
    "/api/admin/guests": { GET: guestListHandler(deps), POST: addGuestHandler(deps) },
    "/api/admin/guests/:discordId": {
      PATCH: setGuestAdminHandler(deps),
      DELETE: removeGuestHandler(deps),
    },
    "/api/admin/requests/:discordId": { DELETE: declineRequestHandler(deps) },
  };
}
