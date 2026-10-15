/**
 * RFC 9457 problem details. Error bodies never echo internal state — the
 * `detail` is written for the person reading it, not for a debugger.
 */
export interface Problem {
  title: string;
  status: number;
  detail: string;
}

export function problemResponse(problem: Problem): Response {
  return new Response(JSON.stringify({ type: "about:blank", ...problem }), {
    status: problem.status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}

export const unauthorized = (): Response =>
  problemResponse({
    title: "Not signed in",
    status: 401,
    detail: "Sign in to continue.",
  });

export const badRequest = (detail: string): Response =>
  problemResponse({ title: "Bad request", status: 400, detail });

/**
 * Signed in, and not allowed. Distinct from `notFound`, which is what an
 * endpoint answers when saying "no" would confirm that an id exists — here the
 * caller can already see the thing, so there is nothing left to hide.
 */
export const forbidden = (detail: string): Response =>
  problemResponse({ title: "Not allowed", status: 403, detail });

export const notFound = (detail: string): Response =>
  problemResponse({ title: "Not found", status: 404, detail });

export const conflict = (detail: string): Response =>
  problemResponse({ title: "Conflict", status: 409, detail });

export const badGateway = (detail: string): Response =>
  problemResponse({ title: "Upstream failure", status: 502, detail });

/**
 * Says nothing about what broke: the details belong in the server log, not in a
 * body the caller can read.
 */
export const serverError = (): Response =>
  problemResponse({
    title: "Something went wrong",
    status: 500,
    detail: "Try again in a moment.",
  });
