import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");
const SKIP = new Set(["node_modules", ".next", "coverage", "test-results", "playwright-report"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith("stale-after.test.ts") ? [path] : [];
  });
}

describe("staleness is relative to cadence", () => {
  it("has no fixed STALE_AFTER_MS anywhere in the frontend", () => {
    const offenders = sources(ROOT).filter((f) => readFileSync(f, "utf8").includes("STALE_AFTER_MS"));
    expect(offenders).toEqual([]);
  });
});
