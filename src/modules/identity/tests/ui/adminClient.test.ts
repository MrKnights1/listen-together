import { afterEach, describe, expect, test } from "bun:test";
import {
  addGuest,
  declineRequest,
  loadGuestList,
  removeGuest,
  setGuestAdmin,
  type GuestList,
} from "@/modules/identity/ui/adminClient.ts";

const realFetch = globalThis.fetch;
const calls: { url: string; init: RequestInit | undefined }[] = [];

/** The network is the boundary here, so it is the only thing substituted. */
function respondWith(respond: () => Promise<Response>): void {
  calls.length = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const LIST: GuestList = { hosts: [], guests: [], requests: [] };

describe("adminClient", () => {
  test("hands back the guest list the server answered with", async () => {
    respondWith(async () => Response.json(LIST));

    expect(await loadGuestList()).toEqual({ ok: true, list: LIST });
  });

  test("sends a new guest as JSON", async () => {
    respondWith(async () => Response.json(LIST, { status: 201 }));

    await addGuest("123456789012345678", "Bob");

    expect(calls[0]?.url).toBe("/api/admin/guests");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(calls[0]?.init?.body).toBe('{"discordId":"123456789012345678","label":"Bob"}');
  });

  test("changes a guest's role with a PATCH carrying JSON", async () => {
    respondWith(async () => Response.json(LIST));

    await setGuestAdmin("123456789012345678", true);

    expect(calls[0]?.url).toBe("/api/admin/guests/123456789012345678");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe('{"isAdmin":true}');
  });

  test("removes and declines by id, escaped into the path", async () => {
    respondWith(async () => Response.json(LIST));

    await removeGuest("123456789012345678");
    expect(calls[0]).toMatchObject({
      url: "/api/admin/guests/123456789012345678",
      init: { method: "DELETE" },
    });
    await declineRequest("a/b");
    expect(calls.at(-1)?.url).toBe("/api/admin/requests/a%2Fb");
  });

  test("passes on the server's own sentence when it refuses", async () => {
    respondWith(async () =>
      Response.json(
        { title: "Conflict", status: 409, detail: "They are already on the guest list." },
        { status: 409 },
      ),
    );

    expect(await addGuest("123456789012345678", null)).toEqual({
      ok: false,
      message: "They are already on the guest list.",
    });
  });

  test("says something plain when the refusal has no sentence", async () => {
    respondWith(async () => new Response("<html>bad gateway</html>", { status: 502 }));

    expect(await loadGuestList()).toEqual({ ok: false, message: "That didn't work. Try again." });
  });

  test("says the room is not answering when the network fails", async () => {
    respondWith(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await loadGuestList()).toEqual({
      ok: false,
      message: "The room isn't answering. Try again in a moment.",
    });
  });
});
