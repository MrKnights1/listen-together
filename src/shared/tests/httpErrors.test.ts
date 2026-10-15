import { describe, expect, test } from "bun:test";
import {
  badRequest,
  conflict,
  problemResponse,
  serverError,
  unauthorized,
} from "@/shared/http/httpErrors.ts";

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("problemResponse", () => {
  test("labels the body as problem details rather than plain JSON", () => {
    const response = problemResponse({ title: "Nope", status: 418, detail: "No coffee here." });

    expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
  });

  test("carries the fields RFC 9457 requires", async () => {
    const response = problemResponse({ title: "Nope", status: 418, detail: "No coffee here." });

    expect(await bodyOf(response)).toEqual({
      type: "about:blank",
      title: "Nope",
      status: 418,
      detail: "No coffee here.",
    });
  });
});

describe("unauthorized", () => {
  test("answers 401", () => {
    expect(unauthorized().status).toBe(401);
  });
});

describe("badRequest", () => {
  test("answers 400 with the reason it was given", async () => {
    const response = badRequest("Send a JSON body with a url.");

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).detail).toBe("Send a JSON body with a url.");
  });
});

describe("conflict", () => {
  test("answers 409 with the reason it was given", async () => {
    const response = conflict("That song is already in your queue.");

    expect(response.status).toBe(409);
    expect((await bodyOf(response)).detail).toBe("That song is already in your queue.");
  });
});

describe("serverError", () => {
  /**
   * The detail of a 500 is read by whoever triggered it, which may be anyone.
   * What actually broke belongs in the server log, not in this body.
   */
  test("answers 500 without describing what went wrong", async () => {
    const response = serverError();

    expect(response.status).toBe(500);
    expect(await bodyOf(response)).toEqual({
      type: "about:blank",
      title: "Something went wrong",
      status: 500,
      detail: "Try again in a moment.",
    });
  });
});
