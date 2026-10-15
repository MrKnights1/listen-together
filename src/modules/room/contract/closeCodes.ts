/**
 * Part of the contract because both ends of the room socket need the same
 * number and neither may import the other: the browser bundle cannot reach
 * `http/`, and the server has no business importing `ui/`.
 *
 * 4000–4999 is the range reserved for applications.
 */

/** The session behind this socket ended: signed out, or expired. Go to /login. */
export const SESSION_ENDED_CLOSE_CODE = 4401;

/**
 * The person is signed in but no longer on the whitelist. Distinct from 4401
 * because reconnecting or signing in again cannot fix it.
 */
export const NOT_ALLOWED_CLOSE_CODE = 4403;
