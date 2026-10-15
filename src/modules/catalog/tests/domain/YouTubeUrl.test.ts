import { describe, expect, test } from "bun:test";
import { isYouTubeHost, parseYouTubeUrl } from "@/modules/catalog/domain/youtube/YouTubeUrl.ts";

const ID = "dQw4w9WgXcQ";
const LIST = "PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";

const parse = (href: string) => parseYouTubeUrl(new URL(href));

describe("parseYouTubeUrl — videos", () => {
  test.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}&feature=share`,
    `https://music.youtube.com/watch?v=${ID}&si=abc`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?t=42`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://WWW.YOUTUBE.COM/watch?v=${ID}`,
  ])("%s is one video", (href) => {
    expect(parse(href)).toEqual({ kind: "video", videoId: ID });
  });

  /** The song on screen when somebody copied the address bar — not the whole list. */
  test("a watch link inside a playlist adds just that video", () => {
    expect(parse(`https://www.youtube.com/watch?v=${ID}&list=${LIST}&index=3`)).toEqual({
      kind: "video",
      videoId: ID,
    });
  });
});

describe("parseYouTubeUrl — playlists", () => {
  test.each([
    `https://www.youtube.com/playlist?list=${LIST}`,
    `https://music.youtube.com/playlist?list=${LIST}`,
    `https://m.youtube.com/playlist?list=${LIST}`,
  ])("%s is a playlist", (href) => {
    expect(parse(href)).toEqual({ kind: "playlist", playlistId: LIST });
  });
});

describe("parseYouTubeUrl — nothing playable", () => {
  test.each([
    "https://www.youtube.com/",
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/results?search_query=song",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=tooShort",
    "https://www.youtube.com/watch?v=waytoolongforanid",
    "https://www.youtube.com/watch?v=bad%2Fchars!!",
    "https://www.youtube.com/playlist",
    "https://www.youtube.com/playlist?list=%3Cscript%3E",
    "https://youtu.be/",
  ])("%s names no video or playlist", (href) => {
    expect(parse(href)).toBeNull();
  });

  test("a look-alike host is not YouTube", () => {
    expect(parse(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
    expect(parse(`https://notyoutube.com/watch?v=${ID}`)).toBeNull();
  });
});

describe("isYouTubeHost", () => {
  test("recognises YouTube's hosts and nothing else", () => {
    expect(isYouTubeHost(new URL("https://youtu.be/x"))).toBe(true);
    expect(isYouTubeHost(new URL("https://music.youtube.com/"))).toBe(true);
    expect(isYouTubeHost(new URL("https://open.spotify.com/track/x"))).toBe(false);
    expect(isYouTubeHost(new URL("https://youtube.com.evil.example/"))).toBe(false);
  });
});
