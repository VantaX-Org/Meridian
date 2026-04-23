import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import auroraWriting from "./eslint-rules/aurora-writing.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Aurora writing system (spec §11) — flags placeholder copy, glossary
  // violations, and apologetic voice. Warns by default; ratchet to error
  // after the initial clean-up sweep.
  {
    plugins: {
      "aurora-writing": auroraWriting,
    },
    rules: {
      "aurora-writing/no-forbidden-copy": "warn",
    },
    // Scope: user-facing Aurora code and dashboard pages. Skip type
    // definitions, config, and the design playground (which intentionally
    // uses anti-pattern strings to demo empty states and error flows).
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/_design-playground/**",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
  },
]);

export default eslintConfig;
