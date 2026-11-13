import { describe, expect, it, beforeEach } from "vitest";
import { csvCell, cycleLine, dqsOf, duration, isCleaned, kindOf, reasonText, recalledRun, rememberRun, signed, statusOf, toOption, valuesText } from "./model";
import type { VersionHead } from "@/lib/api/v2/runs";

const head = (over: Partial<VersionHead> = {}): VersionHead =>
  ({ id: "r2", run_at: "2026-11-10T08:00:00Z", label: null, run_number: 15, parent_version_id: "r1", status: "complete", dqs_summary: { material_master: { composite_score: 77, raw_score: 80, capped: true, total_checks: 140 } }, metadata: { trigger: "upload" }, ...over }) as VersionHead;

describe("object model", () => {
  beforeEach(() => sessionStorage.clear());

  it("reads score, status and kind of a run", () => {
    expect(dqsOf(head(), "material_master")).toBe(77);
    expect(dqsOf(head({ dqs_summary: null }), "material_master")).toBeNull();
    expect(statusOf(head({ status: "failed" }))).toBe("failed");
    expect(statusOf(head({ status: "running" }))).toBe("running");
    expect(statusOf(head())).toBe("done");
    expect(isCleaned(head())).toBe(true);
    expect(kindOf(head())).toBe("Cleaned");
    expect(kindOf(head({ parent_version_id: null, metadata: { trigger: "scheduled" } }))).not.toBe("Cleaned");
  });

  it("builds a switcher option", () => {
    const o = toOption(head(), "material_master", 14);
    expect(o).toMatchObject({ id: "r2", number: 15, parentNumber: 14, status: "done", dqs: "77", kind: "Cleaned" });
  });

  it("writes the cycle line", () => {
    expect(signed(6)).toBe("+6");
    expect(signed(-2.54)).toMatch(/^-2\.5/);
    expect(signed(0)).toBe("0");
    expect(cycleLine(4, 15, 14, 77, 6)).toBe("Cycle 4, Run 15, cleaned from run 14, DQS 77 (+6)");
    expect(cycleLine(null, 3, null, null, null)).toBe("Run 3");
  });

  it("remembers the run per object in session storage", () => {
    expect(recalledRun("s", "m")).toBeNull();
    rememberRun("s", "m", "r9");
    expect(recalledRun("s", "m")).toBe("r9");
    expect(recalledRun("s", "other")).toBeNull();
    rememberRun("s", "m", null);
    expect(recalledRun("s", "m")).toBeNull();
  });

  it("formats durations, reasons, values and CSV cells", () => {
    expect(duration(38)).toBe("38 s");
    expect(duration(252)).toBe("4 min 12 s");
    expect(duration(3900)).toBe("1 h 5 min");
    expect(duration(null)).toBe("—");
    expect(reasonText("data")).toContain("(data)");
    expect(reasonText("Base unit is empty")).toBe("Base unit is empty");
    expect(valuesText(null)).toBe("Not failing");
    expect(valuesText({ MEINS: "" })).toBe("MEINS: (empty)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(null)).toBe("");
  });
});
