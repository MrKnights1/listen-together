import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Injection safety, enforced rather than reviewed. Every value this codebase
 * sends to SQLite is bound with `?` today, and nothing about the language stops
 * the next `WHERE name LIKE '%${term}%'` from compiling and shipping. No linter
 * catches it either: to ESLint a query is a string like any other.
 *
 * The rule is narrow on purpose — a statement may interpolate the *shape* of a
 * parameter list, never a value.
 */
const SRC = resolve(import.meta.dir, "../..");
const COMPOSITION_ROOT = resolve(SRC, "../musicplayer.ts");

/**
 * The only expressions allowed inside a SQL string. Both expand to `?, ?, ?`
 * and take a count, because SQLite cannot bind a list to `IN` and the list's
 * length is therefore part of the statement rather than of its parameters.
 *
 * This is a list you have to consciously edit, like MODULE_ORDER next door.
 * Adding to it is the moment somebody decides a new expression may reach the
 * text of a query, which is exactly the decision worth making on purpose.
 */
const PLACEHOLDER_EXPRESSIONS = [/^placeholders$/, /^placeholders\(\s*[\w.]+\s*\)$/];

/**
 * Anchored at the start of the literal. A statement handed to `query()` opens
 * with its verb, while prose that happens to say "UPDATE" mid-sentence does
 * not — which keeps a JSDoc paragraph in backticks from being read as SQL.
 */
const OPENS_A_STATEMENT =
  /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|PRAGMA|WITH)\b/i;

function productionFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  return [
    ...walk(SRC)
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => !file.includes("/tests/")),
    COMPOSITION_ROOT,
  ];
}

interface SqlString {
  path: string;
  line: number;
  text: string;
}

/** Every template literal and double-quoted string that opens with a SQL verb. */
function sqlStringsIn(file: string): SqlString[] {
  const source = readFileSync(file, "utf8");
  const literals = [
    ...source.matchAll(/`(?:[^`\\]|\\.)*`/g),
    ...source.matchAll(/"(?:[^"\\\n]|\\.)*"/g),
  ];

  return literals
    .map((match) => ({
      path: relative(SRC, file),
      line: source.slice(0, match.index).split("\n").length,
      text: match[0].slice(1, -1),
    }))
    .filter((literal) => OPENS_A_STATEMENT.test(literal.text));
}

const SQL_STRINGS = productionFiles().flatMap(sqlStringsIn);

/** Every `${...}` inside a statement, with the expression it interpolates. */
function interpolationsIn(sql: SqlString[]) {
  return sql.flatMap((statement) =>
    [...statement.text.matchAll(/\$\{([^}]*)\}/g)].map((match) => ({
      ...statement,
      expression: (match[1] ?? "").trim(),
    })),
  );
}

function disallowed(sql: SqlString[]) {
  return interpolationsIn(sql)
    .filter((found) => !PLACEHOLDER_EXPRESSIONS.some((allowed) => allowed.test(found.expression)))
    .map((found) => `${found.path}:${found.line} interpolates \${${found.expression}} into SQL`);
}

describe("SQL injection safety", () => {
  /**
   * The rule below cannot fail if the walk finds nothing, so pin the scan to
   * something that has to be there. A refactor that moves every query behind an
   * abstraction this scan cannot see should break here loudly rather than leave
   * a green test guarding an empty set.
   */
  test("the scan actually finds the statements", () => {
    expect(SQL_STRINGS.length).toBeGreaterThan(1);
    expect(SQL_STRINGS.some((sql) => sql.path.includes("migrator"))).toBe(true);
  });

  test("no statement interpolates anything but a placeholder list", () => {
    expect(disallowed(SQL_STRINGS)).toEqual([]);
  });

  /**
   * The detector, run against an injection it must not miss. Without this the
   * three tests above pass just as happily when the matching is broken.
   */
  test("an interpolated value would be caught", () => {
    const planted: SqlString[] = [
      {
        path: "planted.ts",
        line: 1,
        text: "SELECT * FROM users WHERE discord_id = ${discordId}",
      },
    ];

    expect(disallowed(planted)).toEqual(["planted.ts:1 interpolates ${discordId} into SQL"]);
  });

  /**
   * A near-miss: `placeholders` is allowed by name, so the allowlist must not
   * be so loose that anything mentioning it gets in.
   */
  test("an expression that merely contains the word is not allowed", () => {
    const planted: SqlString[] = [
      {
        path: "planted.ts",
        line: 1,
        text: "SELECT * FROM users WHERE id IN (${placeholders + name})",
      },
    ];

    expect(disallowed(planted)).toHaveLength(1);
  });

  /**
   * SQLite cannot bind an identifier, so a table or column name assembled at
   * runtime can only ever be string-built. Production has none, and the point
   * of saying so here is that adding one has to be deliberate.
   */
  test("no statement builds a table or column name at runtime", () => {
    const found = SQL_STRINGS.filter((sql) =>
      /\b(FROM|JOIN|INTO|UPDATE)\s+\$\{/i.test(sql.text),
    ).map((sql) => `${sql.path}:${sql.line} builds an identifier at runtime`);

    expect(found).toEqual([]);
  });

  /**
   * The scan reads statements as written, so a query assembled with `+` before
   * it reaches `query()` would never be seen. Nothing does that; this is what
   * keeps it that way.
   */
  test("no statement is assembled by concatenation", () => {
    const found = productionFiles()
      .filter((file) =>
        /["`]\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM)[^"`]*["`]\s*\+/i.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => `${relative(SRC, file)} builds SQL with +`);

    expect(found).toEqual([]);
  });
});
