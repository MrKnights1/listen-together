import { contained } from "@/shared/http/contained.ts";
import type { AccessList } from "@/modules/identity/application/AccessList.ts";
import type { GetSessionUser } from "@/modules/identity/application/GetSessionUser.ts";
import { requireSession } from "../requireSession.ts";
import { toUserView } from "../views.ts";

export interface SessionDependencies {
  getSessionUser: GetSessionUser;
  accessList: AccessList;
}

/**
 * `GET /api/auth/session` — who is signed in, and whether they are an admin; a
 * 401, or a 403 for someone taken off the list.
 */
export function sessionHandler(deps: SessionDependencies) {
  return contained("Reading the session", async function GET(request: Request) {
    const result = await requireSession(request, deps.getSessionUser);
    if ("response" in result) return result.response;
    return Response.json({
      user: {
        ...toUserView(result.user),
        isAdmin: await deps.accessList.isAdmin(result.user.discordId),
      },
    });
  });
}
