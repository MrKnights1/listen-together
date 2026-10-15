/**
 * Public surface of the identity module. Shape: LAYERED — the guest list, OAuth
 * state/PKCE matching and session expiry are rules worth testing without a
 * database or Discord.
 */
export { createIdentityRoutes, type IdentityRouteDependencies } from "./http/routes.ts";
export { requireSession } from "./http/requireSession.ts";
export { toUserView, type UserView } from "./http/views.ts";
export { StartDiscordLogin } from "./application/StartDiscordLogin.ts";
export { CompleteDiscordLogin } from "./application/CompleteDiscordLogin.ts";
export { GetSessionUser, type SessionLookup } from "./application/GetSessionUser.ts";
export { LogOut, type SessionEndedListener } from "./application/LogOut.ts";
export { FindUsers } from "./application/FindUsers.ts";
export { PurgeExpiredSessions } from "./application/PurgeExpiredSessions.ts";
export { AccessList } from "./application/AccessList.ts";
export { GetGuestList } from "./application/GetGuestList.ts";
export { AddGuest } from "./application/AddGuest.ts";
export { DeclineAccessRequest } from "./application/DeclineAccessRequest.ts";
export { RemoveGuest, type AccessRevokedListener } from "./application/RemoveGuest.ts";
export { PurgeStaleAccessRequests } from "./application/PurgeStaleAccessRequests.ts";
export { SetGuestAdmin } from "./application/SetGuestAdmin.ts";
export { Hosts } from "./domain/Hosts.ts";
export {
  DISCORD_ENDPOINTS,
  DiscordOAuthClient,
  type DiscordOAuthConfig,
} from "./infrastructure/DiscordOAuthClient.ts";
export { WebCryptoTokenGenerator } from "./infrastructure/WebCryptoTokenGenerator.ts";
export { SqliteUserRepository } from "./infrastructure/persistence/SqliteUserRepository.ts";
export { SqliteSessionRepository } from "./infrastructure/persistence/SqliteSessionRepository.ts";
export { SqliteGuestRepository } from "./infrastructure/persistence/SqliteGuestRepository.ts";
export { SqliteAccessRequestRepository } from "./infrastructure/persistence/SqliteAccessRequestRepository.ts";
export type { User } from "./domain/User.ts";
