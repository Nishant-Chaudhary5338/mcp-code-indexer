import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

/**
 * Base ESLint configuration for all packages (TypeScript).
 *
 * Uses the syntactic `recommended` ruleset (no project-service dependency, so it
 * lints source, tests, and config files uniformly without per-file tsconfig
 * wiring). `no-explicit-any` is a hard error — the code-intelligence engine is
 * judged at a principal bar, so `any` must be a deliberate, lint-disabled
 * exception, never an accident — and type imports are enforced for clean
 * type-only elision.
 */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  eslintConfigPrettier, // Turns off ESLint rules that conflict with Prettier
];

/**
 * React-specific ESLint configuration for apps
 */
export const reactConfig = [
  ...baseConfig,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
];

/**
 * Node-specific ESLint configuration for packages
 */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
];