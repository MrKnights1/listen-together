import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The structural rules, enforced rather than remembered. TypeScript has no
 * module-level visibility, so without this file the boundaries are a naming
 * convention that decays one reasonable-looking import at a time.
 *
 * Every rule below has a companion proving it has input: a check that matches
 * nothing passes forever.
 */
const SRC = resolve(import.meta.dir, "../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function sourceFiles(): string[] {
  return walk(SRC)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !file.includes("/tests/"));
}

function importsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map(
    (match) => match[1] ?? "",
  );
}

/** Every non-test source file, paired with its imports, as src-relative paths. */
const FILES = sourceFiles().map((file) => ({
  path: relative(SRC, file),
  imports: importsOf(file),
}));

function filesUnder(pattern: RegExp) {
  return FILES.filter((file) => pattern.test(file.path));
}

function violations(pattern: RegExp, forbidden: (specifier: string) => boolean) {
  return filesUnder(pattern).flatMap((file) =>
    file.imports.filter(forbidden).map((specifier) => `${file.path} imports ${specifier}`),
  );
}

describe("shared", () => {
  test("has files to check", () => {
    expect(filesUnder(/^shared\//).length).toBeGreaterThan(0);
  });

  test("never depends on a module", () => {
    const found = violations(/^shared\//, (specifier) => specifier.startsWith("@/modules/"));

    expect(found).toEqual([]);
  });

  test("shared/domain imports nothing but other shared/domain files", () => {
    const found = violations(
      /^shared\/domain\//,
      (specifier) => !specifier.startsWith("@/shared/domain/"),
    );

    expect(filesUnder(/^shared\/domain\//).length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });

  /**
   * The import graph cannot see this one: a `.sql` file has no imports, so
   * schema could hide under `src/` with every other rule passing.
   */
  test("no schema hides inside the source tree", () => {
    const found = walk(SRC)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => `${relative(SRC, file)} — migrations live in /migrations at the project root`);

    expect(found).toEqual([]);
  });
});

/**
 * Outside `src/`, so it is not in `FILES`. Naming it here keeps the rules below
 * from passing vacuously the day it is renamed or moved.
 */
const COMPOSITION_ROOT = resolve(SRC, "../musicplayer.ts");

/** Comments stripped, so prose that names a call cannot satisfy an ordering rule. */
function compositionRootCode(): string {
  return readFileSync(COMPOSITION_ROOT, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

describe("the composition root", () => {
  test("is where this file expects it", () => {
    expect(existsSync(COMPOSITION_ROOT)).toBe(true);
  });

  test("stops taking requests before it closes the database", () => {
    const root = compositionRootCode();
    const stopsServer = root.indexOf("server.stop(");
    const closesDatabase = root.indexOf("db.close()");

    // Named so the ordering below cannot pass by both being -1.
    expect([stopsServer, closesDatabase]).not.toContain(-1);
    expect(stopsServer).toBeLessThan(closesDatabase);
  });

  test("is the only thing outside the kernel and modules that wires adapters to ports", () => {
    const found = FILES.filter(
      (file) => !file.path.startsWith("modules/") && !file.path.startsWith("shared/"),
    )
      .filter((file) =>
        file.imports.some((specifier) =>
          /^@\/(shared|modules\/[^/]+)\/infrastructure\//.test(specifier),
        ),
      )
      .map((file) => `${file.path} constructs infrastructure`);

    expect(found).toEqual([]);
  });
});

describe("configuration", () => {
  /**
   * Reading the environment outside the composition root hides a dependency:
   * the module can no longer be constructed differently in a test.
   */
  test("is read only at the composition root", () => {
    const found = FILES.flatMap((file) =>
      file.imports
        .filter((specifier) => specifier === "@/env.ts" || specifier === "./env.ts")
        .map((specifier) => `${file.path} imports ${specifier}`),
    );

    expect(found).toEqual([]);
  });

  test("the composition root is the one place that does read it", () => {
    expect(compositionRootCode()).toContain("readEnv(");
  });

  test("nothing reaches for Bun.env directly", () => {
    const found = [...sourceFiles(), COMPOSITION_ROOT]
      .filter((file) => relative(SRC, file) !== "env.ts")
      .filter((file) => /\bBun\.env\b|\bprocess\.env\b/.test(readFileSync(file, "utf8")))
      .map((file) => `${relative(SRC, file)} reads the environment directly`);

    expect(found).toEqual([]);
  });
});
