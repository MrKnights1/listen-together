import { contained } from "@/shared/http/contained.ts";
import type { LogOut } from "@/modules/identity/application/LogOut.ts";
import { clearSessionCookie, readSessionToken } from "../sessionCookie.ts";

export interface LogOutDependencies {
  logOut: LogOut;
  /** Set the Secure flag on cookies. True whenever the app is served over https. */
  secureCookies: boolean;
}

/**
 * `DELETE /api/auth/session` — end the session and clear the cookie. Signing
 * out is deleting the resource `GET /api/auth/session` reads, and it is
 * idempotent: clearing a cookie that is already dead is not an error.
 */
export function logOutHandler(deps: LogOutDependencies) {
  return contained("Signing out", async function DELETE(request: Request): Promise<Response> {
    await deps.logOut.execute(readSessionToken(request));
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": clearSessionCookie(deps.secureCookies) },
    });
  });
}
