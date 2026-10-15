import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

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

/**
 * Anchored on `bun` as a whole word, not the `bun:` prefix: `from "bun"` has no
 * colon, so a prefix test would wave through an import that breaks the rule.
 */
const IS_BUN = /^bun(:|$)/;
const IS_BUN_OR_REACT = /^(bun(:|$)|react)/;
const IS_RUNTIME = /^(bun(:|$)|node:|react)/;

const BY_PATH = new Map(FILES.map((file) => [file.path, file]));

/** Resolves a first-party specifier to a src-relative path. Null for anything from node_modules. */
function resolveSpecifier(from: string, specifier: string): string | null {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) return join(dirname(from), specifier);
  return null;
}

/** Every first-party file an entry point pulls in, however many barrels deep. */
function reachableFrom(entry: string): Set<string> {
  const reached = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const path = queue.pop() as string;
    const file = BY_PATH.get(path);
    if (file === undefined) continue;

    for (const specifier of file.imports) {
      const target = resolveSpecifier(path, specifier);
      if (target === null || reached.has(target)) continue;
      reached.add(target);
      queue.push(target);
    }
  }

  return reached;
}

describe("domain layer", () => {
  test("has files to check", () => {
    expect(filesUnder(/^modules\/identity\/domain\//).length).toBeGreaterThan(0);
  });

  test("never imports the database, the runtime, or a UI library", () => {
    const found = violations(
      /^modules\/[^/]+\/domain\//,
      (specifier) => IS_RUNTIME.test(specifier) || specifier.startsWith("@/shared/infrastructure"),
    );

    expect(found).toEqual([]);
  });

  test("never reaches outward into its own module's other layers", () => {
    const found = violations(/^modules\/[^/]+\/domain\//, (specifier) =>
      /@\/modules\/[^/]+\/(infrastructure|http|ui|application)/.test(specifier),
    );

    expect(found).toEqual([]);
  });
});

describe("application layer", () => {
  test("has files to check", () => {
    expect(filesUnder(/^modules\/identity\/application\//).length).toBeGreaterThan(0);
  });

  test("never imports the database, HTTP, or its own adapters", () => {
    const found = violations(
      /^modules\/[^/]+\/application\//,
      (specifier) =>
        IS_BUN_OR_REACT.test(specifier) ||
        specifier.startsWith("@/shared/infrastructure") ||
        /@\/modules\/[^/]+\/(infrastructure|http|ui)/.test(specifier),
    );

    expect(found).toEqual([]);
  });
});

describe("http layer", () => {
  test("has files to check", () => {
    expect(filesUnder(/^modules\/identity\/http\//).length).toBeGreaterThan(0);
  });

  test("never reaches past the container into a concrete adapter", () => {
    const found = violations(
      /^modules\/[^/]+\/http\//,
      (specifier) => IS_BUN.test(specifier) || /@\/modules\/[^/]+\/infrastructure/.test(specifier),
    );

    expect(found).toEqual([]);
  });
});

describe("ui layer", () => {
  test("has files to check", () => {
    expect(filesUnder(/^modules\/identity\/ui\//).length).toBeGreaterThan(0);
  });

  test("never imports server-side code into a browser bundle", () => {
    const found = violations(
      /^modules\/[^/]+\/ui\//,
      (specifier) =>
        IS_BUN.test(specifier) ||
        specifier.startsWith("@/shared/infrastructure") ||
        /@\/modules\/[^/]+\/(infrastructure|http|application)/.test(specifier),
    );

    expect(found).toEqual([]);
  });
});

describe("browser entry points", () => {
  test("has files to check", () => {
    expect(filesUnder(/^app\//).length).toBeGreaterThan(0);
  });

  /**
   * Without this, a resolver that silently walked nothing would make the
   * reachability test below pass for every entry point, forever.
   */
  test("the reachability walk actually follows a barrel", () => {
    const reached = reachableFrom("app/login/login.tsx");

    expect(reached).toContain("modules/identity/ui/index.ts");
    expect(reached).toContain("modules/identity/ui/LoginPage.tsx");
  });

  test("never imports server-side code into a browser bundle", () => {
    const found = violations(
      /^app\//,
      (specifier) =>
        IS_BUN.test(specifier) ||
        specifier.startsWith("@/shared/infrastructure") ||
        /@\/modules\/[^/]+\/(infrastructure|http|application|domain)/.test(specifier),
    );

    expect(found).toEqual([]);
  });

  /**
   * The direct rule above cannot see through a barrel: `@/modules/identity/index.ts`
   * is an innocent-looking specifier that re-exports `SqliteUserRepository`.
   * Only following the imports says anything about what ends up in the bundle.
   */
  test("never reaches server-side code through a barrel", () => {
    const found = filesUnder(/^app\//).flatMap((entry) =>
      [...reachableFrom(entry.path)]
        .filter((path) =>
          /^(shared|modules\/[^/]+)\/(infrastructure|http|application)\//.test(path),
        )
        .map((path) => `${entry.path} reaches ${path}`),
    );

    expect(found).toEqual([]);
  });

  /** The walk above must be able to fail: a planted server import has to be caught. */
  test("the reachability walk would catch a server import behind a barrel", () => {
    const reached = reachableFrom("modules/identity/index.ts");

    expect(reached).toContain(
      "modules/identity/infrastructure/persistence/SqliteUserRepository.ts",
    );
  });
});

describe("module boundaries", () => {
  test("a module only ever imports another module through its published surface", () => {
    const found = FILES.flatMap((file) => {
      const owner = /^modules\/([^/]+)\//.exec(file.path)?.[1];
      if (owner === undefined) return [];

      return file.imports
        .filter((specifier) => {
          const target = /^@\/modules\/([^/]+)\//.exec(specifier)?.[1];
          if (target === undefined || target === owner) return false;
          return (
            specifier !== `@/modules/${target}/index.ts` &&
            specifier !== `@/modules/${target}/ui/index.ts`
          );
        })
        .map((specifier) => `${file.path} imports ${specifier}`);
    });

    expect(found).toEqual([]);
  });

  /** Every module declares its shape and the reason, in the file a reader opens first. */
  test("every module's public surface records its shape", () => {
    const missing = MODULE_NAMES.filter((name) => {
      const surfaces = [
        join(SRC, "modules", name, "index.ts"),
        join(SRC, "modules", name, "ui", "index.ts"),
      ];
      return !surfaces.some(
        (surface) =>
          existsSync(surface) && /Shape: (LAYERED|FLAT) — /.test(readFileSync(surface, "utf8")),
      );
    });

    expect(MODULE_NAMES.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});

/**
 * The order modules may depend in, lowest first: a module may import only
 * modules appearing before it. Stronger than forbidding cycles and no more
 * expensive to check — it fails on the import that *starts* the problem.
 */
const MODULE_ORDER = ["identity", "catalog", "room"];

const MODULE_NAMES = readdirSync(join(SRC, "modules")).filter((entry) =>
  statSync(join(SRC, "modules", entry)).isDirectory(),
);

/** Every import that crosses from one module into another. */
function crossModuleImports(): { from: string; to: string; path: string; specifier: string }[] {
  return FILES.flatMap((file) => {
    const owner = /^modules\/([^/]+)\//.exec(file.path)?.[1];
    if (owner === undefined) return [];

    return file.imports.flatMap((specifier) => {
      const target = /^@\/modules\/([^/]+)\//.exec(specifier)?.[1];
      if (target === undefined || target === owner) return [];

      return [{ from: owner, to: target, path: file.path, specifier }];
    });
  });
}

describe("module dependency direction", () => {
  /**
   * Without this the rule below quietly stops covering a module the day one is
   * added. Placing a new module in the order is the moment somebody has to
   * decide what it is allowed to know.
   */
  test("the order names every module, and only real ones", () => {
    expect([...MODULE_ORDER].sort()).toEqual([...MODULE_NAMES].sort());
  });

  test("a module only imports modules below it in the order", () => {
    const rank = new Map(MODULE_ORDER.map((name, index) => [name, index]));

    const found = crossModuleImports()
      .filter((edge) => {
        const from = rank.get(edge.from);
        const to = rank.get(edge.to);
        // An unplaced module is a violation, not a pass.
        if (from === undefined || to === undefined) return true;
        return to > from;
      })
      .map(
        (edge) =>
          `${edge.path} imports ${edge.specifier} — ${edge.from} comes before ${edge.to} in MODULE_ORDER`,
      );

    expect(found).toEqual([]);
  });
});

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

  /**
   * The order nothing else checks and that fails quietly when wrong: suspended
   * after the server stops, a late command still gets saved; closed before the
   * room is suspended, the clean-shutdown save writes to a closed handle and the
   * next boot comes back paused for no reason anyone can see.
   */
  test("stops taking requests, then saves the room, then closes the database", () => {
    const root = compositionRootCode();
    const stopsServer = root.indexOf("server.stop(");
    const suspendsRoom = root.indexOf("roomEngine.suspend(");
    const closesDatabase = root.indexOf("db.close()");

    // Named so the ordering below cannot pass by all three being -1.
    expect([stopsServer, suspendsRoom, closesDatabase]).not.toContain(-1);
    expect(stopsServer).toBeLessThan(suspendsRoom);
    expect(suspendsRoom).toBeLessThan(closesDatabase);
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
