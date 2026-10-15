import { contained } from "@/shared/http/contained.ts";
import type { CompleteDiscordLogin } from "@/modules/identity/application/CompleteDiscordLogin.ts";
import { IdentityError } from "@/modules/identity/domain/errors.ts";
import { redirect } from "../redirect.ts";
import { clearLoginRequestCookie, readLoginRequest, setSessionCookie } from "../sessionCookie.ts";

/**
 * Every reason this handler can send back to `/login?error=`. Four are decided
 * here — `declined`, `expired`, `incomplete`, `unavailable` — and the rest are
 * `IdentityError` codes. A code added to `domain/errors.ts` and not here does
 * not compile: `failed` takes this union.
 */
export const LOGIN_FAILURE_REASONS = [
  "declined",
  "expired",
  "incomplete",
  "invalid_identity",
  "login_request_expired",
  "not_allowed",
  "state_mismatch",
  "unavailable",
] as const;

export type LoginFailureReason = (typeof LOGIN_FAILURE_REASONS)[number];

export interface DiscordCallbackDependencies {
  completeDiscordLogin: CompleteDiscordLogin;
  /** Set the Secure flag on cookies. True whenever the app is served over https. */
  secureCookies: boolean;
}

/**
 * `GET /api/auth/discord/callback` — verify state, redeem the code, check the
 * whitelist, open a session.
 *
 * Every refusal leaves for `/login` with a reason and clears the login request
 * on the way out, so a stale one cannot be replayed against a second attempt.
 */
export function discordCallbackHandler(deps: DiscordCallbackDependencies) {
  return contained(
    "Completing a Discord sign-in",
    async function GET(request: Request): Promise<Response> {
      const failed = (reason: LoginFailureReason): Response =>
        redirect(`/login?error=${reason}`, [clearLoginRequestCookie(deps.secureCookies)]);

      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      // Discord reports a refusal here, e.g. the person pressed Cancel.
      if (url.searchParams.has("error")) return failed("declined");
      if (code === null || state === null) return failed("incomplete");

      const loginRequest = readLoginRequest(request);
      if (loginRequest === null) return failed("expired");

      try {
        const { sessionToken } = await deps.completeDiscordLogin.execute(loginRequest, state, code);
        return redirect("/", [
          setSessionCookie(sessionToken, deps.secureCookies),
          clearLoginRequestCookie(deps.secureCookies),
        ]);
      } catch (error) {
        if (error instanceof IdentityError) return failed(error.code);
        console.error("Discord sign-in failed", error);
        return failed("unavailable");
      }
    },
  );
}
