import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import apiClient, { uploadApiClient } from "@/lib/api/client";
import { cancelJob, exportRunSteps, exportRuns, getCompareRecordKeys, getCompareRecords, getObjectMonitor, getObjectsMonitor, getRunSteps } from "./run-ops";

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
});
