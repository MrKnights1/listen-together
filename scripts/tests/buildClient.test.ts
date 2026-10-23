import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildClient } from "../buildClient.ts";

let workdir: string;
let outdir: string;
let files: string[];

beforeAll(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "musicplayer-build-"));
  outdir = path.join(workdir, "public");
  // A file from an older build, which must not survive the next one.
  await Bun.write(path.join(outdir, "assets", "room-stale.js"), "old");
  files = await buildClient(outdir);
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
});

const read = (file: string) => Bun.file(path.join(outdir, file)).text();

/** Every local URL a page loads: its stylesheet, script and icon. */
async function referencedBy(page: string): Promise<string[]> {
  const html = await read(page);
  return [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1] as string);
}

describe("buildClient", () => {
  test("writes the three pages nginx serves at /, /login and /admin", () => {
    expect(files).toContain("room.html");
    expect(files).toContain("login.html");
    expect(files).toContain("admin.html");
  });

  test.each(["room.html", "login.html", "admin.html"])(
    "%s loads only hashed files under /assets/ that the build wrote",
    async (page) => {
      const urls = await referencedBy(page);

      expect(urls.length).toBeGreaterThanOrEqual(3);
      for (const url of urls) {
        expect(url).toMatch(/^\/assets\/[\w-]+-[a-z0-9]{8}\.(js|css|svg)$/);
        expect(files).toContain(url.slice(1));
      }
    },
  );

  /** The Content Security Policy allows no inline script. */
  test("puts no inline script in a page", async () => {
    for (const page of ["room.html", "login.html", "admin.html"]) {
      const scripts = [...(await read(page)).matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);

      expect(scripts.length).toBeGreaterThan(0);
      for (const tag of scripts) expect(tag).toContain(" src=");
    }
  });

  /** React's error decoder link is in its runtime and nowhere else. */
  test("puts React in one chunk that all three pages load", async () => {
    const scripts = files.filter((file) => file.endsWith(".js"));
    const withReact: string[] = [];
    for (const file of scripts)
      if ((await read(file)).includes("react.dev/errors")) withReact.push(file);

    expect(withReact).toHaveLength(1);
    for (const page of ["room.html", "login.html", "admin.html"]) {
      expect(await referencedBy(page)).toContain(`/${withReact[0]}`);
    }
  });

  /** The smoke check after a deploy only follows what the pages name: what scripts import must be there too. */
  test("writes every chunk the scripts import", async () => {
    const imported: string[] = [];
    for (const file of files.filter((name) => name.endsWith(".js"))) {
      for (const match of (await read(file)).matchAll(
        /(?:from|import\()\s*"\/(assets\/[^"]+\.js)"/g,
      )) {
        imported.push(match[1] as string);
      }
    }

    // The pages import the shared chunk: finding no import at all means this looked in the wrong place.
    expect(imported.length).toBeGreaterThanOrEqual(3);
    for (const chunk of imported) expect(files).toContain(chunk);
  });

  test("ships React's production build", async () => {
    const scripts = files.filter((file) => file.endsWith(".js"));

    for (const file of scripts) {
      expect(await read(file)).not.toContain("Download the React DevTools");
    }
  });

  /** The policy allows `data:` for fonts and nothing else: the bundler inlines them into the CSS. */
  test("inlines nothing but fonts as data: URLs", async () => {
    for (const file of files.filter((name) => name.endsWith(".css"))) {
      const inlined = [...(await read(file)).matchAll(/url\(\s*["']?data:([^;,]+)/g)].map(
        (match) => match[1],
      );

      expect(inlined.every((type) => type === "font/woff2")).toBe(true);
    }
  });

  test("leaves a gzip copy beside every text file, holding the same bytes", async () => {
    const text = files.filter((file) => /\.(html|js|css|svg)$/.test(file));

    expect(text.length).toBeGreaterThanOrEqual(7);
    for (const file of text) {
      expect(files).toContain(`${file}.gz`);
      const original = await Bun.file(path.join(outdir, file)).bytes();
      const unzipped = Bun.gunzipSync(await Bun.file(path.join(outdir, `${file}.gz`)).bytes());
      expect(Buffer.from(unzipped).equals(Buffer.from(original))).toBe(true);
    }
    expect(files.filter((file) => file.endsWith(".gz.gz"))).toEqual([]);
  });

  test("clears out the files of an older build", () => {
    expect(files).not.toContain(path.join("assets", "room-stale.js"));
  });

  test("fails loudly when it cannot write the output", async () => {
    const blocked = path.join(workdir, "a-file");
    await writeFile(blocked, "not a directory");

    await expect(buildClient(path.join(blocked, "public"))).rejects.toThrow();
  });
});
