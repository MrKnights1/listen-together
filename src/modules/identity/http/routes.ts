import {
  discordCallbackHandler,
  type DiscordCallbackDependencies,
} from "./handlers/discordCallbackHandler.ts";
import { logOutHandler, type LogOutDependencies } from "./handlers/logOutHandler.ts";
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
    LogOutDependencies {}

/** Which method on which path, and nothing else. One handler per file. */
export function createIdentityRoutes(deps: IdentityRouteDependencies) {
  return {
    "/api/auth/discord/start": { GET: startDiscordLoginHandler(deps) },
    "/api/auth/discord/callback": { GET: discordCallbackHandler(deps) },
    // Reading the session says who is signed in; deleting it signs them out.
    "/api/auth/session": { GET: sessionHandler(deps), DELETE: logOutHandler(deps) },
  };
}
