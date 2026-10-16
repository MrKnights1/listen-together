/**
 * Builds the two pages for production. nginx serves the result; the Bun
 * process never bundles in production.
 *
 *   room.html, login.html,  served at /, /login and /admin, revalidated on
 *   admin.html              every visit
 *   assets/<name>-<hash>.*  everything they load, named by content so it can
 *                           be cached for a year
 *   *.gz                    a gzip copy of each text file, for gzip_static
 *
 *   bun run build:client
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const ENTRYPOINTS = [
  "src/app/room/room.html",
  "src/app/login/login.html",
  "src/app/admin/admin.html",
];
/** Already compressed, or too small to gain: woff2 and images are left alone. */
const COMPRESSIBLE = /\.(html|js|css|svg)$/;

/** Builds into `outdir`, emptied first so no file from an older build lingers. Returns the paths written, relative to it. */
export async function buildClient(outdir: string): Promise<string[]> {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: ENTRYPOINTS,
    outdir,
    target: "browser",
    minify: true,
    // Absolute, so a page at any path finds its assets.
    publicPath: "/",
    naming: {
      entry: "[name].[ext]",
      chunk: "assets/[name]-[hash].[ext]",
      asset: "assets/[name]-[hash].[ext]",
    },
    // React's production build: no development checks, no DevTools hint.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "The client build failed");
  }

  const written = await filesUnder(outdir);
  for (const file of written.filter((name) => COMPRESSIBLE.test(name))) {
    const full = path.join(outdir, file);
    await Bun.write(`${full}.gz`, Bun.gzipSync(await Bun.file(full).bytes(), { level: 9 }));
  }
  return filesUnder(outdir);
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
    .sort();
}

if (import.meta.main) {
  const outdir = path.resolve("dist/public");
  const files = await buildClient(outdir);
  for (const file of files) {
    console.log(`${file}  ${Bun.file(path.join(outdir, file)).size} bytes`);
  }
}
