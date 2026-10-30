import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import meridianWriting from "./eslint-rules/meridian-writing.mjs";
import meridianStructure from "./eslint-rules/meridian-structure.mjs";

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
  // The writing and structure rules (DESIGN.md, Words) flag placeholder copy, glossary violations and an
  // apologetic voice. Every rule is an error; CI runs eslint with --max-warnings 0.
  {
    plugins: {
      "meridian-writing": meridianWriting,
      "meridian-structure": meridianStructure,
    },
    rules: {
      "meridian-writing/no-forbidden-copy": "error",
      "meridian-writing/format-date-only": "error",
      "meridian-writing/no-raw-id": "error",
      "meridian-structure/one-h1": "error",
      "meridian-structure/tally-figure-numeric": "error",
      "meridian-writing/no-forbidden-glyphs": "error",
      "meridian-structure/tally-figure-href": "error",
      "meridian-structure/one-tally": "error",
      "meridian-structure/tally-verdict": "error",
      "meridian-structure/chart-rules": "error",
      "meridian-structure/severity-via-badge": "error",
      "meridian-structure/sap-name-in-chip": "error",
      "meridian-structure/empty-state-no-media": "error",
      "meridian-structure/no-invented-progress": "error",
      "meridian-structure/url-is-state": "error",
    },
    // Scope: the pages, the shared code and the interface library. Tests are skipped.
    files: [
      "app/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
      "design/v2/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
  },
  // DESIGN.md §3 "Icons": every glyph comes from design/icons. No third-party icon library.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          { name: "lucide-react", message: "Use the Meridian icon set in @/design (design/icons)." },
          { name: "@heroicons/react", message: "Use the Meridian icon set in @/design (design/icons)." },
          { name: "react-icons", message: "Use the Meridian icon set in @/design (design/icons)." },
          { name: "@phosphor-icons/react", message: "Use the Meridian icon set in @/design (design/icons)." },
        ],
        patterns: ["lucide-react/*", "@heroicons/react/*", "react-icons/*", "@tabler/icons-react*"],
      }],
    },
  },
  // DESIGN.md "No inline style": no `style` prop anywhere under app/ (design/ owns every style).
  {
    files: ["app/**/*.{ts,tsx}"],
    plugins: { "meridian-structure": meridianStructure },
    rules: { "meridian-structure/no-inline-style": "error" },
  },
]);

export default eslintConfig;
