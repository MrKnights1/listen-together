import { contained } from "@/shared/http/contained.ts";
import type { StartDiscordLogin } from "@/modules/identity/application/StartDiscordLogin.ts";
import { redirect } from "../redirect.ts";
import { setLoginRequestCookie } from "../sessionCookie.ts";

export interface StartDiscordLoginDependencies {
  startDiscordLogin: StartDiscordLogin;
  /** Set the Secure flag on cookies. True whenever the app is served over https. */
  secureCookies: boolean;
}

/** `GET /api/auth/discord/start` — remember this sign-in in a cookie and go to Discord. */
export function startDiscordLoginHandler(deps: StartDiscordLoginDependencies) {
  return contained("Starting a Discord sign-in", async function GET(): Promise<Response> {
    const { authorizationUrl, loginRequest } = await deps.startDiscordLogin.execute();
    return redirect(authorizationUrl, [setLoginRequestCookie(loginRequest, deps.secureCookies)]);
  });
}
