import { BrandMark } from "@/shared/ui/BrandMark.tsx";
import { Icon } from "@/shared/ui/Icon.tsx";

/** Anything unrecognised falls back to the generic line, never a raw code. */
const MESSAGES: Record<string, string> = {
  declined: "Sign-in was cancelled on Discord. Try again when you're ready.",
  expired: "That sign-in took too long. Start again.",
  login_request_expired: "That sign-in took too long. Start again.",
  state_mismatch: "That sign-in couldn't be matched to this browser. Start again.",
  not_allowed:
    "You're not on this room's guest list yet. The admins have been asked to let you in — sign in again once they have.",
  // Not a sign-in failure: an open room or page found its session no longer allowed.
  removed:
    "You're no longer on this room's guest list. Sign in again to ask the admins to let you back in.",
  invalid_identity: "Discord didn't send a usable account. Try again.",
  unavailable: "Discord didn't respond. Try again in a moment.",
};

const GENERIC = "Discord sign-in didn't complete. Try again.";

export function LoginPage({ error }: { error: string | null }) {
  const message = error === null ? null : (MESSAGES[error] ?? GENERIC);

  return (
    <main className="login">
      <div className="login__card">
        <BrandMark className="login__mark" />
        <h1 className="login__title">Listening room</h1>
        <p className="login__lede">
          One queue, one song, everyone hearing it at the same moment. Sign in with the Discord
          account the room knows you by.
        </p>
        <p className="login__note">You stay signed in on this device until you sign out.</p>

        {message !== null && (
          <p className="notice" role="alert">
            <Icon name="alert" />
            {message}
          </p>
        )}

        <a className="discord-button" href="/api/auth/discord/start">
          Sign in with Discord
        </a>
      </div>
    </main>
  );
}
