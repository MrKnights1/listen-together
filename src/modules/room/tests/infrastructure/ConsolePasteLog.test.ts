import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConsolePasteLog } from "@/modules/room/infrastructure/ConsolePasteLog.ts";

let logged: unknown[][];
const original = console.info;

beforeEach(() => {
  logged = [];
  console.info = (...args: unknown[]) => logged.push(args);
});

afterEach(() => {
  console.info = original;
});

describe("ConsolePasteLog", () => {
  test("writes a paste as one labelled line holding the link exactly as pasted", () => {
    const pasted = "https://www.youtube.com/playlist?list=PL123&si=abc";

    new ConsolePasteLog().record({ actorId: "user-1", pasted, scope: "playlist", added: 40 });

    expect(logged).toEqual([
      [
        "Link pasted",
        '{"actorId":"user-1","pasted":"https://www.youtube.com/playlist?list=PL123&si=abc","scope":"playlist","added":40}',
      ],
    ]);
  });

  test("keeps a pasted newline from starting a forged line of its own", () => {
    const pasted = 'youtu.be/x\nLink pasted {"actorId":"someone-else"}\r';

    new ConsolePasteLog().record({ actorId: "user-1", pasted, scope: "song", added: 1 });

    const line = logged[0]!.join(" ");
    expect(line).not.toMatch(/[\r\n]/);
    const written = JSON.parse(line.slice("Link pasted ".length)) as { pasted: string };
    expect(written.pasted).toBe(pasted);
  });
});
