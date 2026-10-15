/**
 * `set-cookie` is appended rather than assigned: the callback sets two cookies
 * in one response, and `Headers` keeps only the last value for an assigned name.
 */
export function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
