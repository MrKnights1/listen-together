import { describe, expect, test } from "bun:test";
import { offersPlaylistChoice } from "@/modules/catalog/domain/LinkScope.ts";

const ID = "dQw4w9WgXcQ";
const LIST = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";

describe("offersPlaylistChoice", () => {
  test.each([
    `https://www.youtube.com/watch?v=${ID}&list=${LIST}&index=46`,
    `youtube.com/watch?v=${ID}&list=${LIST}`,
    `  https://youtu.be/${ID}?list=${LIST}  `,
  ])("asks about %s, a song inside a playlist", (pasted) => {
    expect(offersPlaylistChoice(pasted)).toBe(true);
  });

  test.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/playlist?list=${LIST}`,
    `https://www.youtube.com/watch?v=${ID}&list=LL`,
    `https://open.spotify.com/track/abc?list=${LIST}`,
  ])("does not ask about %s, which names only one thing", (pasted) => {
    expect(offersPlaylistChoice(pasted)).toBe(false);
  });

  /** Adding it is what explains the problem, as for any other bad paste. */
  test.each(["", "hello", "javascript:alert(1)"])(
    "does not ask about %p, which is no link",
    (pasted) => {
      expect(offersPlaylistChoice(pasted)).toBe(false);
    },
  );
});
