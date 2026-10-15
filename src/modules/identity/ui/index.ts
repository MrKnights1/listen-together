/**
 * Browser-side surface of the identity module. Separate from `../index.ts`,
 * which is the server surface and reaches `bun:sqlite` — never allowed in a
 * bundle.
 */
export { AdminPage } from "./AdminPage.tsx";
export { LoginPage } from "./LoginPage.tsx";
export { SignOutButton } from "./SignOutButton.tsx";
export { loadSession, signOut, type SessionState, type SessionUser } from "./sessionClient.ts";
