import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

/**
 * Deliberately narrow. `tsconfig.json` already forbids unused locals, implicit
 * `any` and unchecked index access, so rules that repeat the compiler stay off.
 * What earns its place is the type-aware set: a floating promise is invisible to
 * `tsc`, and this codebase is full of async I/O and socket handlers.
 *
 * Layer and module import rules are NOT here. They live in
 * `src/shared/tests/moduleBoundaries.test.ts`.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "data/**",
      ".playwright-mcp/**",
      "test-results/**",
      "playwright-report/**",
      "migrations/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * `console.error` and `console.warn` report trouble the server survived.
       * `console.log` is reserved for the entry points that print on purpose.
       */
      "no-console": ["error", { allow: ["warn", "error"] }],

      /**
       * Off while repositories are ports: `bun:sqlite` is synchronous, but the
       * ports are declared `Promise<T>` so the application layer never learns
       * which adapter answered. The adapters say `async` and never await.
       */
      "@typescript-eslint/require-await": "off",

      /** tsconfig's `noUnusedParameters` already spares `_`; match it here. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },

  /** The composition root announces what it did at boot; scripts print their results. */
  {
    files: ["musicplayer.ts", "scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },

  /** The paste log prints on purpose: the server log is where a host finds the link behind a paste. */
  {
    files: [
      "src/modules/room/infrastructure/ConsolePasteLog.ts",
      "src/modules/room/tests/infrastructure/ConsolePasteLog.test.ts",
    ],
    rules: { "no-console": ["error", { allow: ["warn", "error", "info"] }] },
  },

  /** `exhaustive-deps` is what stands between the room socket and a stale closure. */
  {
    files: ["**/*.tsx"],
    ...reactHooks.configs.flat["recommended-latest"],
  },

  /**
   * Tests await fakes that satisfy an async port without being async, and
   * `expect(...).rejects`, which bun-types does not describe as thenable.
   */
  {
    files: [
      "**/tests/**/*.ts",
      "**/tests/**/*.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "e2e/**/*.ts",
    ],
    rules: { "@typescript-eslint/await-thenable": "off" },
  },

  /** Formatting belongs to Prettier alone. Must stay last but one. */
  prettier,

  /** This file is outside the TypeScript project, so it gets no typed rules. */
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
