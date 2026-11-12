import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import apiClient, { uploadApiClient } from "@/lib/api/client";
import { cancelJob, getFindingRecords, parseEventFrame, renameRun, rerunAgents, streamRunEvents, exportRunSteps, exportRuns, getCompareRecordKeys, getCompareRecords, getObjectMonitor, getObjectsMonitor, getRunSteps } from "./run-ops";

const urlOf = (spy: ReturnType<typeof vi.spyOn>, i = 0): URL => {
  const [path, config] = spy.mock.calls[i] as [string, { params?: Record<string, unknown> }];
  return new URL(uploadApiClient.getUri({ url: path, params: config.params }), "http://meridian.test");
};

describe("run-side clients ask the endpoints the backend serves", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem("mn_v2_fixture");
    window.URL.createObjectURL = vi.fn(() => "blob:x");
    window.URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it("exports the runs list with the list's filters", async () => {
    const spy = vi.spyOn(uploadApiClient, "get").mockResolvedValue({ data: new Blob(["x"]), headers: {} });
    await exportRuns("csv", { system_id: "sys-1", include_archived: true });
    const url = urlOf(spy);
    expect(url.pathname).toBe("/api/v1/runs/export");
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("system_id")).toBe("sys-1");
    expect(url.searchParams.get("include_archived")).toBe("true");
  });

  it("exports a run's steps", async () => {
    const spy = vi.spyOn(uploadApiClient, "get").mockResolvedValue({ data: new Blob(["x"]), headers: {} });
    await exportRunSteps("run 1", "xlsx");
    const url = urlOf(spy);
    expect(url.pathname).toBe("/api/v1/runs/run%201/steps/export");
    expect(url.searchParams.get("format")).toBe("xlsx");
  });

  it("reads steps, compare records and monitors", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: {} });
    await getRunSteps("r1");
    await getCompareRecords("b", "a");
    await getCompareRecordKeys("MM-001", { v2: "b", v1: "a", change: "resolved", search: "", limit: 100, offset: 200 });
    await getObjectsMonitor();
    await getObjectMonitor("material_master");
    const calls = get.mock.calls.map(([u, c]) => [u, (c as { params?: Record<string, unknown> } | undefined)?.params]);
    expect(calls[0]).toEqual(["/api/v1/runs/r1/steps", undefined]);
    expect(calls[1]).toEqual(["/api/v1/versions/compare/records", { v2: "b", v1: "a" }]);
    expect(calls[2]).toEqual(["/api/v1/versions/compare/records/MM-001", { v2: "b", v1: "a", change: "resolved", limit: 100, offset: 200 }]);
    expect(calls[3][0]).toBe("/api/v1/objects/monitor");
    expect(calls[4][0]).toBe("/api/v1/objects/material_master/monitor");
  });

  it("fixture mode answers steps, with the failed run stopping at its error", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    const ok = await getRunSteps("f0000000-0000-4000-8000-0000000000f1");
    expect(ok.steps.at(-1)?.status).toBe("failed");
    expect(ok.steps.at(-1)?.error_detail).toBeTruthy();
    window.sessionStorage.removeItem("mn_v2_fixture");
  });

  it("fixture mode cancels a running job once, then refuses with 409", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    window.history.pushState({}, "", "/?job=running");
    const id = "dl-e0000000-0000-4000-8000-0000000000e1";
    const { getJobById } = await import("./runs");
    expect((await cancelJob(id)).status).toBe("cancelled");
    await expect(cancelJob(id)).rejects.toMatchObject({ status: 409 });
    expect((await getJobById(id)).status).toBe("cancelled");
    window.history.pushState({}, "", "/");
    window.sessionStorage.removeItem("mn_v2_fixture");
  });

  it("cancels a job with a POST and no body", async () => {
    const req = vi.spyOn(apiClient, "request").mockResolvedValue({ data: { id: "j1", status: "cancelled", tasks_revoked: true } });
    const out = await cancelJob("j1");
    expect(req).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", url: "/api/v1/jobs/j1/cancel" }));
    expect(out.status).toBe("cancelled");
  });

  it("renames a run with a PATCH that carries the label only", async () => {
    const req = vi.spyOn(apiClient, "request").mockResolvedValue({ data: { id: "v 1", label: "Cutover" } });
    await renameRun("v 1", "Cutover");
    expect(req).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", url: "/api/v1/versions/v%201", data: { label: "Cutover" } }));
  });

  it("re-runs the agents with a POST and no body", async () => {
    const req = vi.spyOn(apiClient, "request").mockResolvedValue({ data: { version_id: "v1", job_id: "j1", status: "agents_enqueued" } });
    expect((await rerunAgents("v1")).job_id).toBe("j1");
    expect(req).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", url: "/api/v1/versions/v1/run-agents" }));
  });

  it("reads a page of failing records", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { version_id: "v1", check_id: "MM-001", total: 0, records: [] } });
    await getFindingRecords("v1", "MM-001", { limit: 25, offset: 50 });
    const [path, config] = get.mock.calls[0] as [string, { params?: Record<string, unknown> }];
    expect(path).toBe("/api/v1/versions/v1/findings/MM-001/records");
    expect(config.params).toEqual({ limit: 25, offset: 50 });
  });

  it("fixture mode renames, re-runs and pages records without the network", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    expect((await renameRun("r1", "Named")).label).toBe("Named");
    expect((await rerunAgents("r1")).status).toBe("agents_enqueued");
    const p1 = await getFindingRecords("r1", "MM-001", { limit: 25, offset: 0 });
    const p6 = await getFindingRecords("r1", "MM-001", { limit: 25, offset: 125 });
    expect(p1.records).toHaveLength(25);
    expect(p6.records).toHaveLength(p1.total - 125);
    window.sessionStorage.removeItem("mn_v2_fixture");
  });

  it("parses event frames: JSON data, plain data, and comments", () => {
    expect(parseEventFrame('event: progress\ndata: {"pct":40}')).toEqual({ type: "progress", data: { pct: 40 } });
    expect(parseEventFrame("event: complete\ndata: done")).toEqual({ type: "complete", data: "done" });
    expect(parseEventFrame(": keep-alive")).toBeNull();
  });

  it("streams events from the endpoint until the body ends", async () => {
    const enc = new TextEncoder();
    const chunks = [enc.encode('event: progress\ndata: {"pct":1}\n\nevent: comp'), enc.encode("lete\ndata: {}\n\n")];
    const reader = { read: vi.fn(async () => (chunks.length ? { value: chunks.shift(), done: false } : { value: undefined, done: true })) };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, body: { getReader: () => reader } } as unknown as Response);
    const seen: string[] = [];
    await new Promise<void>((resolve) => streamRunEvents("v1", (e) => seen.push(e.type), () => resolve()));
    expect(String(fetchSpy.mock.calls[0][0])).toBe("/api/v1/events/v1");
    expect(seen).toEqual(["progress", "complete"]);
  });

  it("reports a refused stream through onEnd", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 403, body: null } as unknown as Response);
    const err = await new Promise((resolve) => streamRunEvents("v1", () => undefined, (e) => resolve(e)));
    expect(String(err)).toContain("403");
  });

  it("fixture mode ends the stream at once without a request", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await new Promise<void>((resolve) => streamRunEvents("r1", () => undefined, () => resolve()));
    expect(fetchSpy).not.toHaveBeenCalled();
    window.sessionStorage.removeItem("mn_v2_fixture");
  });
});
