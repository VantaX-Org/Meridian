// No silent global run: a page without ?run= shows the latest finished run relevant to it (per object lineage
// on an object page), ?run= pins another one, and "Back to latest" is offered only while it is pinned.
import { describe, expect, it } from "vitest";
import type { DQSSummary, Version } from "@/types/api";
import { hrefWithRun, latestFinishedRun, lineageChoices, resolveScope, runChoiceLabels, runFileName, runHasObject, runName, runScopeLabel, runSourceLabel } from "../run-scope";

const score = { composite_score: 80 } as DQSSummary;

const run = (id: string, at: string, over: Partial<Version> = {}): Version => ({
  id, label: id, status: "complete", run_at: `2026-10-${at}T05:00:00Z`, dqs_summary: null, metadata: {}, ...over,
});
const upload = (id: string, at: string, module: string, over: Partial<Version> = {}) =>
  run(id, at, { metadata: { modules: [module] }, dqs_summary: { [module]: score }, ...over });

// Newest first, as the run list arrives; one object's uploads are one lineage.
const BP_NEW = upload("business_partner_100k", "16", "business_partner");
const CO = upload("controlling_1k", "15", "controlling");
const MM_NEW = upload("material_master_25k", "14", "material_master");
const MM_RUNNING = upload("material_master_50k", "17", "material_master", { status: "running" });
const MM_OLD = upload("material_master_10k", "10", "material_master");
const BP_OLD = upload("business_partner_10k", "09", "business_partner");
const RUNS = [MM_RUNNING, BP_NEW, CO, MM_NEW, MM_OLD, BP_OLD];

describe("runHasObject", () => {
  it("reads the scored objects and the requested modules", () => {
    expect(runHasObject(MM_NEW, "material_master")).toBe(true);
    expect(runHasObject(run("x", "01", { metadata: { modules: ["fi_gl"] } }), "fi_gl")).toBe(true);
    expect(runHasObject(MM_NEW, "business_partner")).toBe(false);
  });
});

describe("latestFinishedRun", () => {
  it("is the newest finished run across objects on a cross-object page", () => {
    expect(latestFinishedRun(RUNS)?.id).toBe("business_partner_100k");
  });

  it("is the object's own newest finished run on an object page, never another object's newer run", () => {
    expect(latestFinishedRun(RUNS, { object: "material_master" })?.id).toBe("material_master_25k");
    expect(latestFinishedRun(RUNS, { object: "controlling" })?.id).toBe("controlling_1k");
    expect(latestFinishedRun(RUNS, { object: "fi_gl" })).toBeUndefined();
  });

  it("skips runs outside a scoped user's systems, and archived runs", () => {
    const sys = run("sys_run", "12", { metadata: { system_id: "s1", modules: ["material_master"] } });
    expect(latestFinishedRun([...RUNS, sys], { systems: new Set(["s1"]) })?.id).toBe("sys_run");
    const archived = upload("material_master_99k", "15", "material_master", { metadata: { modules: ["material_master"], archived: true } });
    expect(latestFinishedRun([archived, ...RUNS], { object: "material_master" })?.id).toBe("material_master_25k");
  });
});

describe("lineageChoices", () => {
  it("offers the finished runs of the shown run's lineage only, newest first", () => {
    expect(lineageChoices(MM_NEW, RUNS).map((v) => v.id)).toEqual(["material_master_25k", "material_master_10k"]);
    expect(lineageChoices(BP_OLD, RUNS).map((v) => v.id)).toEqual(["business_partner_100k", "business_partner_10k"]);
  });

  it("keeps the shown run even when it is not in the list or not finished", () => {
    expect(lineageChoices(MM_RUNNING, RUNS).map((v) => v.id)).toEqual(["material_master_50k", "material_master_25k", "material_master_10k"]);
    const older = upload("material_master_1k", "01", "material_master");
    expect(lineageChoices(older, RUNS).map((v) => v.id)).toContain("material_master_1k");
  });
});

describe("resolveScope", () => {
  it("defaults to the latest relevant run without ?run=, and is not pinned", () => {
    const s = resolveScope({ versions: RUNS, object: "material_master" });
    expect(s).toMatchObject({ runId: "material_master_25k", latestId: "material_master_25k", explicit: undefined, pinned: false });
    expect(s.run?.id).toBe("material_master_25k");
    expect(resolveScope({ versions: RUNS }).runId).toBe("business_partner_100k");
  });

  it("follows a ?run= deep link and offers Back to latest when it is an older run", () => {
    const s = resolveScope({ explicit: "material_master_10k", versions: RUNS, object: "material_master" });
    expect(s).toMatchObject({ runId: "material_master_10k", latestId: "material_master_25k", pinned: true });
    expect(s.choices.map((v) => v.id)).toEqual(["material_master_25k", "material_master_10k"]);
  });

  it("is not pinned when ?run= names the latest run", () => {
    expect(resolveScope({ explicit: "material_master_25k", versions: RUNS, object: "material_master" }).pinned).toBe(false);
  });

  it("treats an empty ?run= as no run", () => {
    expect(resolveScope({ explicit: "", versions: RUNS }).runId).toBe("business_partner_100k");
  });

  it("keeps a ?run= the list does not hold yet, without a run to name", () => {
    const s = resolveScope({ explicit: "unknown", versions: RUNS });
    expect(s).toMatchObject({ runId: "unknown", run: undefined, pinned: true, choices: [] });
  });
});

describe("hrefWithRun", () => {
  it("sets ?run= and keeps the other parameters", () => {
    expect(hrefWithRun("/objects/material_master", new URLSearchParams("tab=rules"), "v2")).toBe("/objects/material_master?tab=rules&run=v2");
  });

  it("clears ?run= for Back to latest", () => {
    expect(hrefWithRun("/objects/material_master", new URLSearchParams("run=v1&tab=rules"), null)).toBe("/objects/material_master?tab=rules");
    expect(hrefWithRun("/insights", "run=v1", null)).toBe("/insights");
  });
});

describe("run labels", () => {
  it("names the run by its objects and when it ran, never by the upload's file name", () => {
    expect(runName(MM_NEW)).toMatch(/^Material master, 14 Oct(, 2026)?, 05:00$/);
    expect(runName(MM_NEW)).not.toContain("material_master_25k");
    expect(runScopeLabel(MM_NEW)).toBe(runName(MM_NEW));
    expect(runName(run("x", "14", { label: null, metadata: { modules: ["material_master", "controlling", "fi_gl"] } }))).toMatch(/^Material master and 2 more, /);
    expect(runName(run("x", "14", { label: "controlling_1k" }))).toMatch(/^Controlling, /);
    expect(runName(run("x", "14", { label: "Quarter close check" }))).toBe("Quarter close check");
  });

  it("keeps the file name as secondary text", () => {
    expect(runFileName(MM_NEW)).toBe("material_master_25k");
    expect(runFileName(run("x", "14", { label: "Quarter close check" }))).toBeUndefined();
    expect(runFileName(run("x", "14", { label: "x", metadata: { file_name: "mm.xlsx" } }))).toBe("mm.xlsx");
  });

  it("names the source: the system when known, else upload", () => {
    expect(runSourceLabel(MM_NEW)).toBe("upload");
    expect(runSourceLabel(run("s", "14", { metadata: { system_id: "s1" } }), "ECC production")).toBe("ECC production");
  });

  it("adds the run number only where two runs still read the same", () => {
    const a = upload("a", "14", "controlling", { label: null, run_number: 1 });
    const b = upload("b", "14", "controlling", { label: null, run_number: 2 });
    const labels = runChoiceLabels([a, b, MM_NEW]);
    expect(labels.get("a")).toMatch(/, run 1$/);
    expect(labels.get("b")).toMatch(/, run 2$/);
    expect(labels.get("material_master_25k")).toBe(runName(MM_NEW));
    const c = upload("c", "15", "controlling", { label: null, run_at: "2026-10-15T09:30:00Z", run_number: 3 });
    expect(runChoiceLabels([a, c]).get("c")).toBe(runName(c));
  });
});
