import { forbidden } from "@/shared/http/httpErrors.ts";
import type { AccessList } from "@/modules/identity/application/AccessList.ts";
import type { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import type { User } from "@/modules/identity/domain/User.ts";
import { requireSession } from "./requireSession.ts";

/** A request to a route with a `:discordId` in its path, as Bun hands it over. */
export type DiscordIdRequest = Request & { params: { discordId: string } };

export interface AdminGate {
  getSessionUser: GetSessionUser;
  accessList: AccessList;
  /** The app's own origin. A change to the guest list from anywhere else is refused. */
  appOrigin: string;
}

/**
 * The server-side gate for the admin API: signed in, and an admin. A change must
 * also carry our own Origin — `SameSite=Lax` already keeps the cookie off a
 * cross-site POST, and this does not rely on that alone.
 */
export async function requireAdmin(
  request: Request,
  gate: AdminGate,
  { changes }: { changes: boolean },
): Promise<{ user: User } | { response: Response }> {
  if (changes && request.headers.get("origin") !== gate.appOrigin) {
    return { response: forbidden("Changes to the guest list must come from this site.") };
  }

  const result = await requireSession(request, gate.getSessionUser);
  if ("response" in result) return result;

  if (!(await gate.accessList.isAdmin(result.user.discordId))) {
    return { response: forbidden("Only admins can manage guests.") };
  }
  return { user: result.user };
}
