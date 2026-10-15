import { afterEach, describe, expect, test } from "bun:test";
import { loadSession } from "@/modules/identity/ui/sessionClient.ts";

const realFetch = globalThis.fetch;

/** The network is the boundary here, so it is the only thing substituted. */
function respondWith(respond: () => Promise<Response>): void {
  globalThis.fetch = (async () => respond()) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const USER = {
  id: "user-1",
  name: "Ada Lovelace",
  avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
};

describe("loadSession", () => {
  test("reports the signed-in user the server named", async () => {
    respondWith(async () => Response.json({ user: USER }));

    expect(await loadSession()).toEqual({ status: "signed-in", user: USER });
  });

  test("reports signed out when the server refuses the session", async () => {
    respondWith(async () => new Response(null, { status: 401 }));

    expect(await loadSession()).toEqual({ status: "signed-out" });
  });

  /**
   * Distinct from signed out: the room sends this person to an explanation, not
   * back round the sign-in loop that would only refuse them again.
   */
  test("reports not allowed when the server says the account was taken off the list", async () => {
    respondWith(async () => new Response(null, { status: 403 }));

    expect(await loadSession()).toEqual({ status: "not-allowed" });
  });

  /**
   * The regression that matters: these three used to throw, and the throw
   * escaped a top-level await in the page entry point — leaving the page
   * on its loading placeholder permanently, with no message and no way back.
   */
  test("reports unreachable when the server fails", async () => {
    respondWith(async () => new Response("boom", { status: 500 }));

    expect(await loadSession()).toEqual({ status: "unreachable" });
  });

  test("reports unreachable when the connection never lands", async () => {
    respondWith(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await loadSession()).toEqual({ status: "unreachable" });
  });

  test("reports unreachable when the body is not the JSON promised", async () => {
    respondWith(async () => new Response("<html>gateway</html>", { status: 200 }));

    expect(await loadSession()).toEqual({ status: "unreachable" });
  });

  test("asks the session endpoint", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: string) => {
      requested.push(input);
      return new Response(null, { status: 401 });
    }) as unknown as typeof fetch;

    await loadSession();

    expect(requested).toEqual(["/api/auth/session"]);
  });
});
