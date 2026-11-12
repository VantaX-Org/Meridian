import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { budgetMessage, budgetOf, clicksOf, type Journey } from "./journey-budget";

// read at run time: the frontend image builds from frontend/ alone, so a static import of docs/ would not type-check there
const JOURNEYS: Journey[] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "journeys", "steps.json"), "utf8"));
const BUDGETED = JOURNEYS.filter((j) => j.target_clicks !== undefined);

describe("journey click budgets", () => {
  it("rounds the target plus 20 percent up", () => {
    expect(budgetOf(4)).toBe(5);
    expect(budgetOf(5)).toBe(6);
    expect(budgetOf(10)).toBe(12);
    expect(budgetOf(3)).toBe(4);
  });

  it("budgets at least one journey, each a positive whole number, with unique ids", () => {
    expect(BUDGETED.length).toBeGreaterThan(0);
    for (const j of BUDGETED) expect(Number.isInteger(j.target_clicks) && (j.target_clicks ?? 0) > 0, j.id).toBe(true);
    expect(new Set(JOURNEYS.map((j) => j.id)).size).toBe(JOURNEYS.length);
  });

  it.each(BUDGETED.map((j) => [j.id, j] as const))("%s stays within its budget", (_, j) => {
    const target = j.target_clicks as number;
    const clicks = clicksOf(j);
    expect(clicks <= budgetOf(target), budgetMessage(j.id, clicks, target)).toBe(true);
  });
});
