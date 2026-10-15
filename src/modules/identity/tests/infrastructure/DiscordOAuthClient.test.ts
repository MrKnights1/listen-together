import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { DiscordOAuthClient } from "@/modules/identity/infrastructure/DiscordOAuthClient.ts";

/**
 * The real adapter against a local stand-in for Discord. Discord is the
 * external boundary, so it is the only thing replaced: every request the
 * adapter makes is real HTTP, recorded here for the assertions.
 */
interface Recorded {
  path: string;
  method: string;
  authorization: string | null;
  contentType: string | null;
  form: Record<string, string>;
}

let fakeDiscord: Server<unknown>;
let recorded: Recorded[];
let tokenStatus: number;
let profileBody: unknown;
let revokeStatus: number;

beforeAll(() => {
  fakeDiscord = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const text = request.method === "POST" ? await request.text() : "";
      recorded.push({
        path: url.pathname,
        method: request.method,
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type"),
        form: Object.fromEntries(new URLSearchParams(text)),
      });

      if (url.pathname === "/api/oauth2/token") {
        return tokenStatus === 200
          ? Response.json({
              access_token: "discord-access",
              token_type: "Bearer",
              scope: "identify",
            })
          : Response.json({ error: "invalid_grant" }, { status: tokenStatus });
      }
      if (url.pathname === "/api/v10/users/@me") return Response.json(profileBody);
      if (url.pathname === "/api/oauth2/token/revoke") {
        return new Response(null, { status: revokeStatus });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => void fakeDiscord.stop(true));

beforeEach(() => {
  recorded = [];
  tokenStatus = 200;
  revokeStatus = 200;
  profileBody = { id: "80351110224678912", username: "ada", global_name: "Ada", avatar: "a1b2" };
});

function client(): DiscordOAuthClient {
  const base = fakeDiscord.url.origin;
  return new DiscordOAuthClient({
    clientId: "client-id",
    clientSecret: "s3cret value",
    redirectUri: "http://localhost:3000/api/auth/discord/callback",
    endpoints: {
      authorize: `${base}/oauth2/authorize`,
      token: `${base}/api/oauth2/token`,
      revoke: `${base}/api/oauth2/token/revoke`,
      currentUser: `${base}/api/v10/users/@me`,
    },
  });
}

/** Silences the adapter's expected warnings, and returns what it said. */
async function quietly<T>(run: () => Promise<T>): Promise<{ result: T; warnings: unknown[][] }> {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    return { result: await run(), warnings };
  } finally {
    console.warn = original;
  }
}

describe("DiscordOAuthClient.authorizationUrl", () => {
  test("asks for the identify scope only, with state and an S256 PKCE challenge", async () => {
    const url = new URL(await client().authorizationUrl("state-1", "verifier-1"));
    const expectedChallenge = new Bun.CryptoHasher("sha256")
      .update("verifier-1")
      .digest("base64url");

    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/discord/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe(expectedChallenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("never puts the verifier or the secret in the URL", async () => {
    const url = await client().authorizationUrl("state-1", "verifier-1");

    expect(url).not.toContain("verifier-1");
    expect(url).not.toContain("s3cret");
  });
});

describe("DiscordOAuthClient.exchangeCode", () => {
  test("returns the profile Discord describes", async () => {
    expect(await client().exchangeCode("code-1", "verifier-1")).toEqual({
      id: "80351110224678912",
      username: "ada",
      globalName: "Ada",
      avatarHash: "a1b2",
    });
  });

  test("redeems the code with a form body, HTTP Basic client auth and the PKCE verifier", async () => {
    await client().exchangeCode("code-1", "verifier-1");

    const token = recorded.find((request) => request.path === "/api/oauth2/token");
    expect(token?.method).toBe("POST");
    expect(token?.contentType).toBe("application/x-www-form-urlencoded");
    // RFC 6749 §2.3.1: the secret's space is form-encoded as %20 before base64.
    expect(token?.authorization).toBe(
      `Basic ${Buffer.from("client-id:s3cret%20value").toString("base64")}`,
    );
    expect(token?.form).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "http://localhost:3000/api/auth/discord/callback",
      code_verifier: "verifier-1",
    });
  });

  test("reads the profile with the access token as a Bearer credential", async () => {
    await client().exchangeCode("code-1", "verifier-1");

    const me = recorded.find((request) => request.path === "/api/v10/users/@me");
    expect(me?.method).toBe("GET");
    expect(me?.authorization).toBe("Bearer discord-access");
  });

  test("revokes Discord's token once the profile is in hand", async () => {
    await client().exchangeCode("code-1", "verifier-1");

    const revoke = recorded.find((request) => request.path === "/api/oauth2/token/revoke");
    expect(revoke?.form).toEqual({ token: "discord-access", token_type_hint: "access_token" });
    expect(recorded.map((request) => request.path)).toEqual([
      "/api/oauth2/token",
      "/api/v10/users/@me",
      "/api/oauth2/token/revoke",
    ]);
  });

  test("turns a missing display name and avatar into nulls", async () => {
    profileBody = { id: "80351110224678912", username: "ada", global_name: null };

    const profile = await client().exchangeCode("code-1", "verifier-1");

    expect(profile.globalName).toBeNull();
    expect(profile.avatarHash).toBeNull();
  });

  test("fails without echoing the secret when Discord rejects the code", async () => {
    tokenStatus = 400;

    const failure = await client()
      .exchangeCode("code-1", "verifier-1")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Discord rejected the authorization code (HTTP 400).");
    expect((failure as Error).message).not.toContain("s3cret");
  });

  test("fails on a profile without an id, and still revokes the token", async () => {
    profileBody = { username: "ada" };

    await expect(client().exchangeCode("code-1", "verifier-1")).rejects.toThrow(
      "missing the id or username",
    );
    expect(recorded.some((request) => request.path === "/api/oauth2/token/revoke")).toBe(true);
  });

  test("does not fail a good sign-in because revocation failed", async () => {
    revokeStatus = 503;

    const { result, warnings } = await quietly(() => client().exchangeCode("code-1", "verifier-1"));

    expect(result.id).toBe("80351110224678912");
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings)).not.toContain("discord-access");
  });
});
