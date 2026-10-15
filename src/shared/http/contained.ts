import { serverError } from "@/shared/http/httpErrors.ts";

/**
 * The server parameter is part of the type because the stream route needs it to
 * upgrade. Handlers that do not care simply ignore it.
 */
export type Handler<Req extends Request = Request, Srv = unknown, Res = Response | undefined> = (
  request: Req,
  server: Srv,
) => Promise<Res>;

/**
 * Turns anything thrown inside a handler into a 500 that says nothing.
 *
 * Bun serves an escaped route exception with its message and the handler's
 * source attached in development, so no handler may be left unwrapped. Each one
 * wraps itself rather than being wrapped by the route table, so a handler added
 * later cannot be left bare by someone editing a different file.
 */
export function contained<Req extends Request, Srv, Res>(
  name: string,
  handler: Handler<Req, Srv, Res>,
): Handler<Req, Srv, Res | Response> {
  return async (request, server) => {
    try {
      return await handler(request, server);
    } catch (error) {
      console.error(`${name} failed`, error);
      return serverError();
    }
  };
}
