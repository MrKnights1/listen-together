import { forbidden, unauthorized } from "@/shared/http/httpErrors.ts";
import type { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import type { User } from "@/modules/identity/domain/User.ts";
import { readSessionToken } from "./sessionCookie.ts";

/**
 * The server-side gate for anything that returns data. The page shells are
 * static files anyone can fetch; this is the line that protects the room.
 */
export async function requireSession(
  request: Request,
  getSessionUser: GetSessionUser,
): Promise<{ user: User; sessionToken: string } | { response: Response }> {
  const sessionToken = readSessionToken(request);
  const lookup = await getSessionUser.execute(sessionToken);

  if (lookup.status === "not_allowed") {
    return { response: forbidden("Your Discord account is no longer on this room's guest list.") };
  }

  // The token is returned for the caller that outlives its request — the room
  // socket, which has to ask again later whether the session is still alive.
  return lookup.status === "signed_out" || sessionToken === null
    ? { response: unauthorized() }
    : { user: lookup.user, sessionToken };
}
