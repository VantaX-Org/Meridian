import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTourHref, type TourLinkSources } from "./tour-links";
import { TOURS, tourById, tourForPath } from "./tours";

const ROOT = path.resolve(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "__tests__" ? [] : sourceFiles(rel);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [rel] : [];
  });
}

/** Every `data-tour="x"` or `dataTour="x"` literal in the UI source. */
function tourTargetsInSource(): Set<string> {
  const found = new Set<string>();
  for (const dir of ["app", "design", "components"]) {
    for (const file of sourceFiles(dir)) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      for (const m of src.matchAll(/\b(?:data-tour|dataTour)=\{?"([a-z0-9-]+)"\}?/g)) found.add(m[1]);
    }
  }
  return found;
}

describe("tour definitions", () => {
  it("has the four persona tours and the first-run tour", () => {
    expect(TOURS.map((t) => t.id)).toEqual(["steward", "lead", "basis", "process", "first-run"]);
  });

  it("gives each persona tour 5 to 7 steps and the first-run tour 2", () => {
    for (const id of ["steward", "lead", "basis", "process"]) {
      const n = tourById(id)!.steps.length;
      expect(n, id).toBeGreaterThanOrEqual(5);
      expect(n, id).toBeLessThanOrEqual(7);
    }
    expect(tourById("first-run")!.steps).toHaveLength(2);
  });

  it("only points at data-tour attributes that exist in the source", () => {
    const present = tourTargetsInSource();
    const missing = TOURS.flatMap((t) => t.steps.filter((s) => !present.has(s.target)).map((s) => `${t.id}: ${s.target}`));
    expect(missing).toEqual([]);
  });

  it("offers each persona tour on its home route", () => {
    expect(tourForPath("/home/steward")?.id).toBe("steward");
    expect(tourForPath("/home/lead")?.id).toBe("lead");
    expect(tourForPath("/home/basis")?.id).toBe("basis");
    expect(tourForPath("/home/process")?.id).toBe("process");
    expect(tourForPath("/objects")).toBeUndefined();
  });

  it("writes copy in sentence case with no empty text", () => {
    for (const t of TOURS) for (const s of t.steps) {
      expect(s.title.trim()).not.toBe("");
      expect(s.body.trim()).not.toBe("");
      expect(s.title).not.toMatch(/^[A-Z][a-z]*( [A-Z][a-z]+){2,}$/);
    }
  });
});

describe("resolveTourHref", () => {
  const sources: TourLinkSources = {
    run: async () => "r1",
    system: async () => "s1",
    object: async () => "material_master",
    process: async () => ({ l1: "PTP", runId: "pr1", systemId: "s2" }),
  };

  it("returns a plain href untouched", async () => {
    expect(await resolveTourHref("/inbox", sources)).toBe("/inbox");
  });

  it("fills run, object and system tokens", async () => {
    expect(await resolveTourHref("/objects/{object}?run={run}&tab=rules", sources)).toBe("/objects/material_master?run=r1&tab=rules");
    expect(await resolveTourHref("/systems/{system}?tab=health", sources)).toBe("/systems/s1?tab=health");
  });

  it("takes the system a process was found on", async () => {
    expect(await resolveTourHref("/process/{l1}?system={system}&run={l1run}&tab=variants", sources)).toBe("/process/PTP?system=s2&run=pr1&tab=variants");
  });

  it("resolves to null when a token has no value", async () => {
    expect(await resolveTourHref("/systems/{system}", { ...sources, system: async () => null })).toBeNull();
    expect(await resolveTourHref("/process/{l1}", { ...sources, process: async () => null })).toBeNull();
  });

  it("does not look up a token the href does not use", async () => {
    const calls: string[] = [];
    await resolveTourHref("/runs/{run}", {
      run: async () => { calls.push("run"); return "r1"; },
      system: async () => { calls.push("system"); return "s1"; },
      object: async () => { calls.push("object"); return "o"; },
      process: async () => { calls.push("process"); return null; },
    });
    expect(calls).toEqual(["run"]);
  });
});
