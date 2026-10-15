/** Mirrors the API's `UserView`. */
export interface SessionUser {
  id: string;
  name: string;
  avatarUrl: string;
}

/**
 * `unreachable` is an answer rather than a thrown error: a rejected promise at
 * a page's top level leaves whatever was on screen there for good.
 * `not-allowed` is apart from `signed-out` because signing in again cannot fix it.
 */
export type SessionState =
  | { status: "signed-in"; user: SessionUser }
  | { status: "signed-out" }
  | { status: "not-allowed" }
  | { status: "unreachable" };

/**
 * The browser's *convenience* check, not the security boundary — the server
 * re-decides on every request and every socket command.
 */
export async function loadSession(): Promise<SessionState> {
  try {
    const response = await fetch("/api/auth/session");
    if (response.status === 401) return { status: "signed-out" };
    if (response.status === 403) return { status: "not-allowed" };
    if (!response.ok) return { status: "unreachable" };

    const body = (await response.json()) as { user: SessionUser };
    return { status: "signed-in", user: body.user };
  } catch {
    // Offline, DNS failure, a connection dropped mid-body, malformed JSON.
    return { status: "unreachable" };
  }
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } finally {
    window.location.replace("/login");
  }
}
