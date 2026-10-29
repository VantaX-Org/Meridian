import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JobProgress } from "./JobProgress";
import type { Job } from "../../types/jobs";

const SKIP = new Set(["node_modules", ".next", "coverage", "dist", "out", "test-results", "playwright-report"]);
const EXT = /\.(tsx?|mjs|cjs|js|css|md|json|txt|vtt)$/; // vtt: the help recordings' captions
const DOT = String.fromCharCode(0xb7); // the test file itself must not contain the glyph

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

describe("no middle dot (U+00B7)", () => {
  it("appears nowhere in the frontend source tree", () => {
    const files = walk(process.cwd(), []);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((f) => readFileSync(f, "utf8").includes(DOT));
    expect(hits).toEqual([]);
  });

  it.each([
    ["old", `Checks \u2014 material_master ${DOT} rule 3/5 ${DOT} CHK-1`],
    ["new", "Checks \u2014 material_master | rule 3/5 | CHK-1"],
  ])("JobProgress splits a %s-format worker message into separate elements", (_n, message) => {
    const now = Date.now() / 1000;
    const job: Job = {
      id: "j", kind: "analysis", status: "running", label: "Analysis", stage: null, stages: [], percent: 50,
      rows_done: 0, rows_total: 0, tables: [], error: null, result: null, started_at: now - 60, updated_at: now, finished_at: null,
      message,
    };
    const { container } = render(<JobProgress job={job} />);
    expect(container.textContent).not.toContain(DOT);
    expect(container.textContent).not.toContain("|");
    expect(screen.getByText("CHK-1")).toBeInTheDocument();
    expect(screen.getByText("rule 3/5")).toBeInTheDocument();
  });
});
