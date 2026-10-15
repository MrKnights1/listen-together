import { contained } from "@/shared/http/contained.ts";
import type { AccessList } from "@/modules/identity/application/AccessList.ts";
import type { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import { requireSession } from "../requireSession.ts";
import { setSessionCookie } from "../sessionCookie.ts";
import { toUserView } from "../views.ts";

export interface SessionDependencies {
  getSessionUser: GetSessionUser;
  accessList: AccessList;
  /** Set the Secure flag on cookies. True whenever the app is served over https. */
  secureCookies: boolean;
}

/**
 * `GET /api/auth/session` — who is signed in, and whether they are an admin; a
 * 401, or a 403 for someone taken off the list.
 *
 * Every page asks this as it loads, so it also hands the browser its session
 * cookie again with a full lifetime: the browser's copy never runs out while
 * the person keeps coming back. It may outlive the server's renewed expiry by
 * under a day, which only means the server says no a little sooner.
 */
export function sessionHandler(deps: SessionDependencies) {
  return contained("Reading the session", async function GET(request: Request) {
    const result = await requireSession(request, deps.getSessionUser);
    if ("response" in result) return result.response;
    return Response.json(
      {
        user: {
          ...toUserView(result.user),
          isAdmin: await deps.accessList.isAdmin(result.user.discordId),
        },
      },
      {
        headers: {
          "Set-Cookie": setSessionCookie(result.sessionToken, deps.secureCookies),
          // It carries the session cookie: no cache in between may keep a copy.
          "Cache-Control": "no-store",
        },
      },
    );
  });
}
