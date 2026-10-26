// The one "Do next" of a scope: the lowest-scoring object, and the rule that caps it.
import { describe, expect, it } from "vitest";
import type { DQSSummary, Version } from "@/types/api";
import { stateObjects } from "./current-state";
import { doNext } from "./do-next";
import { formatMoneyShort } from "./format";

const summary = (score: number | null, capReason: string | null = null): DQSSummary => ({
  composite_score: score, dimension_scores: {}, critical_count: capReason ? 1 : 0, high_count: 0, medium_count: 0, low_count: 0,
  total_checks: 10, passing_checks: 9, capped: !!capReason, cap_reason: capReason,
}) as DQSSummary;
const run = (id: string, run_at: string, modules: Record<string, DQSSummary>): Version =>
  ({ id, label: id, run_at, status: "complete", dqs_summary: modules, metadata: { modules: Object.keys(modules) } }) as unknown as Version;

// The newest run measured employee central only; HCM, the lowest score, comes from an older run.
const runs = [
  run("ec", "2026-10-16T05:00:00Z", { employee_central: summary(70, "EC341: cost centre has no external code — score capped at 70") }),
  run("hcm", "2026-10-15T05:00:00Z", { hcm: summary(64.5, "PA021: no employment status; PA022: no org unit — score capped at 70") }),
  run("mm", "2026-10-14T05:00:00Z", { material_master: summary(82.9) }),
];

describe("doNext", () => {
  it("starts with the lowest-scoring object of the scope and the first rule that caps it, in the run it is read from", () => {
    const step = doNext(stateObjects(runs));
    expect(step).toMatchObject({ module: "hcm", rule: "PA021", runId: "hcm", score: 64.5 });
    expect(step?.sentence).toBe("Start with HCM personnel administration, the lowest score at 64.5: fix PA021, which caps it");
    // The current state needs no ?run=: Fix work opens on it.
    expect(step?.action).toEqual({ label: "Fix PA021", href: "/fix?module=hcm&check=PA021" });
  });

  it("keeps a pinned run on the link, and opens the object when no rule caps it", () => {
    const step = doNext(stateObjects([runs[2]]), { pinned: true });
    expect(step?.sentence).toBe(`Start with ${step?.label}, the lowest score at 82.9`);
    expect(step?.rule).toBeNull();
    expect(step?.action.href).toBe("/objects/material_master?run=mm");
  });

  it("breaks a tie in object order, as the objects list ranks the worst first", () => {
    const tied = [run("a", "2026-10-16T00:00:00Z", { sd_sales_orders: summary(70) }), run("b", "2026-10-15T00:00:00Z", { accounts_receivable: summary(70) })];
    expect(doNext(stateObjects(tied))?.module).toBe("accounts_receivable");
  });

  it("is null when nothing is scored", () => {
    expect(doNext(stateObjects([run("x", "2026-10-16T00:00:00Z", { hcm: summary(null) })]))).toBeNull();
    expect(doNext([])).toBeNull();
  });
});

describe("formatMoneyShort", () => {
  it("writes a large amount in three figures with its unit and currency", () => {
    expect(formatMoneyShort(4_840_487_383, "ZAR")).toBe("ZAR 4.84 bn");
    expect(formatMoneyShort(12_500_000, "ZAR")).toBe("ZAR 12.5 m");
    expect(formatMoneyShort(830_400, "EUR")).toBe("EUR 830 k");
  });
});
