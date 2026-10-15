import { signOut } from "./sessionClient.ts";

export function SignOutButton() {
  return (
    <button type="button" className="link-button" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}
