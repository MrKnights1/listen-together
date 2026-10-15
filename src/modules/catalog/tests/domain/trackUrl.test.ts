import { describe, expect, test } from "bun:test";
import { InvalidTrackUrl } from "@/modules/catalog/domain/errors.ts";
import { MAX_URL_LENGTH, parseTrackUrl } from "@/modules/catalog/domain/trackUrl.ts";

describe("parseTrackUrl", () => {
  test("reads an ordinary link", () => {
    expect(parseTrackUrl("https://youtu.be/dQw4w9WgXcQ").hostname).toBe("youtu.be");
  });

  test("ignores the whitespace a paste drags along", () => {
    expect(parseTrackUrl("  https://youtu.be/dQw4w9WgXcQ\n").pathname).toBe("/dQw4w9WgXcQ");
  });

  test("accepts a link pasted without its scheme", () => {
    expect(parseTrackUrl("youtu.be/dQw4w9WgXcQ").href).toBe("https://youtu.be/dQw4w9WgXcQ");
  });

  test.each([
    "",
    "   ",
    "not a link at all",
    "hello",
    "javascript:alert(1)",
    "ftp://youtu.be/x",
    "http://localhost/watch",
  ])("refuses %p", (pasted) => {
    expect(() => parseTrackUrl(pasted)).toThrow(InvalidTrackUrl);
  });

  test("refuses something longer than any real link", () => {
    expect(() => parseTrackUrl(`https://youtu.be/${"a".repeat(MAX_URL_LENGTH)}`)).toThrow(
      InvalidTrackUrl,
    );
  });
});
