import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import auroraWriting from "./eslint-rules/aurora-writing.mjs";
import auroraStructure from "./eslint-rules/aurora-structure.mjs";

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
  // violations, and apologetic voice. Every rule is an error; CI runs
  // eslint with --max-warnings 0.
  {
    plugins: {
      "aurora-writing": auroraWriting,
      "aurora-structure": auroraStructure,
    },
    rules: {
      "aurora-writing/no-forbidden-copy": "error",
      "aurora-writing/no-forbidden-glyphs": "error",
      "aurora-structure/tally-figure-href": "error",
      "aurora-structure/one-tally": "error",
      "aurora-structure/tally-verdict": "error",
      "aurora-structure/chart-rules": "error",
      "aurora-structure/severity-via-badge": "error",
      "aurora-structure/sap-name-in-chip": "error",
      "aurora-structure/empty-state-no-media": "error",
      "aurora-structure/no-invented-progress": "error",
      "aurora-structure/url-is-state": "error",
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
  // TanStack Table's hook returns functions React Compiler cannot memoize.
  // DataTable is the single wrapper around it and opts out with "use no memo",
  // which this lint rule does not recognise.
  {
    files: ["components/aurora/data/table.tsx"],
    rules: { "react-hooks/incompatible-library": "off" },
  },
]);

export default eslintConfig;
