/** Anything unrecognised falls back to the generic line, never a raw code. */
const MESSAGES: Record<string, string> = {
  declined: "Sign-in was cancelled on Discord. Try again when you're ready.",
  expired: "That sign-in took too long. Start again.",
  login_request_expired: "That sign-in took too long. Start again.",
  state_mismatch: "That sign-in couldn't be matched to this browser. Start again.",
  not_allowed:
    "Your Discord account isn't on this room's guest list. Ask whoever runs the room to add your Discord user ID.",
  invalid_identity: "Discord didn't send a usable account. Try again.",
  unavailable: "Discord didn't respond. Try again in a moment.",
};

const GENERIC = "Discord sign-in didn't complete. Try again.";

export function LoginPage({ error }: { error: string | null }) {
  const message = error === null ? null : (MESSAGES[error] ?? GENERIC);

  return (
    <main className="login">
      <h1 className="login__title">Listening room</h1>
      <p className="login__lede">
        One queue, one song, everyone hearing it at the same moment. Sign in with the Discord
        account the room knows you by.
      </p>

      {message !== null && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}

      <a className="discord-button" href="/api/auth/discord/start">
        Sign in with Discord
      </a>
    </main>
  );
}
