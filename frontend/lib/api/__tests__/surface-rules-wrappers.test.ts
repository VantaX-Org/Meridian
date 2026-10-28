// Wrappers for backend features surfaced on the rule, object and Fix work pages: the URLs, bodies and request-access flags they send.
import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { getFindingImpact, getModuleForecast } from "../analytics";
import { acceptDependency } from "../field-profile";
import { commentIssue, getIssue } from "../issues";
import { diffRows, getModuleCoverage, getRuleVersionDiff } from "../rules";
import { TERMINAL_EVENTS, parseFrame, streamRunEvents } from "../run-events";
import { fixHref } from "../../drill";

afterEach(() => vi.restoreAllMocks());

describe("rule version diff", () => {
  it("reads one version against the one before it, and a 403 opens the request-access dialog", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { rule_id: "AP001", from: "v1", to: "v2", diff: "" } });
    await expect(getRuleVersionDiff("AP001", 2)).resolves.toMatchObject({ from: "v1", to: "v2" });
    expect(get).toHaveBeenCalledWith("/api/v1/rules/AP001/versions/2/diff", { requestAccess: true });
  });

  it("keeps only the added and removed lines of a unified diff", () => {
    const unified = "--- shipped@abc\n+++ v1\n@@ -1,3 +1,3 @@\n field: MARA.MEINS\n-severity: high\n+severity: critical\n+message: Base unit is empty\n";
    expect(diffRows(unified)).toEqual([
      { change: "removed", line: "severity: high" },
      { change: "added", line: "severity: critical" },
      { change: "added", line: "message: Base unit is empty" },
    ]);
    expect(diffRows("")).toEqual([]);
  });
});

describe("rule coverage per object", () => {
  it("asks for the object's coverage and opens the request-access dialog on a 403", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { totals: { rules: 40, never_run: 6 } } });
    await getModuleCoverage("fi_gl");
    expect(get).toHaveBeenCalledWith("/api/v1/rules/coverage/fi_gl", { params: undefined, requestAccess: true });
  });
});

describe("finding impact and forecast", () => {
  it("reads the impact of one finding, and reads a 404 as no impact model", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValueOnce({ data: { finding_id: "f1", finding: {}, impacts: [{ category: "inventory_write_off", annual_risk: 10 }] } });
    await expect(getFindingImpact("f1")).resolves.toMatchObject({ finding_id: "f1" });
    expect(get).toHaveBeenCalledWith("/api/v1/analytics/impact/f1", { requestAccess: true });
    get.mockRejectedValueOnce(Object.assign(new Error("nf"), { isAxiosError: true, response: { status: 404 } }));
    await expect(getFindingImpact("f2")).resolves.toBeNull();
  });

  it("reads one object's forecast", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { module_id: "fi_gl", forecast: null, history: [], message: "Need at least 3 data points" } });
    await expect(getModuleForecast("fi_gl")).resolves.toMatchObject({ forecast: null });
    expect(get).toHaveBeenCalledWith("/api/v1/analytics/forecast/fi_gl", { requestAccess: true });
  });
});

describe("confirm a dependency", () => {
  it("posts the mined dependency of the object to /rules/mined", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { id: "r1", name: "HR-1: MTART determines MBRSH" } });
    await expect(acceptDependency({ module: "material_master", determinant: "MTART", dependent: "MBRSH" })).resolves.toMatchObject({ id: "r1" });
    expect(post).toHaveBeenCalledWith("/api/v1/rules/mined", { module: "material_master", determinant: "MTART", dependent: "MBRSH" });
  });
});

describe("record issue comments", () => {
  it("reads the issue thread with the request-access flag and posts a comment body", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { issue: {}, events: [], runs: [] } });
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { ok: true } });
    await getIssue("i-1");
    expect(get).toHaveBeenCalledWith("/api/v1/issues/i-1", { requestAccess: true });
    await commentIssue("i-1", "Checked with finance");
    expect(post).toHaveBeenCalledWith("/api/v1/issues/i-1/comments", { body: "Checked with finance" });
  });
});

describe("run events", () => {
  it("parses a frame into its event and JSON body, and skips a heartbeat", () => {
    expect(parseFrame("event: progress\ndata: {\"percent\": 40}")).toEqual({ event: "progress", data: { percent: 40 } });
    expect(parseFrame(": heartbeat")).toBeNull();
    expect(parseFrame("data: not json")).toEqual({ event: "message", data: {} });
    expect(TERMINAL_EVENTS.has("complete")).toBe(true);
    expect(TERMINAL_EVENTS.has("progress")).toBe(false);
  });

  it("streams a run's frames with the bearer token and ends quietly when the server closes", async () => {
    const enc = new TextEncoder();
    const chunks = [enc.encode("event: progress\ndata: {\"percent\": 10}\n\n: heart"), enc.encode("beat\n\nevent: complete\ndata: {}\n\n")];
    const body = new ReadableStream<Uint8Array>({ start(c) { chunks.forEach((x) => c.enqueue(x)); c.close(); } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("mn_auth_token", "tok");
    const events: string[] = [];
    await new Promise<void>((resolve) => { streamRunEvents("v 1", (e) => events.push(e.event), () => resolve()); });
    expect(events).toEqual(["progress", "complete"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/events/v%201");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Accept: "text/event-stream", Authorization: "Bearer tok" });
    localStorage.removeItem("mn_auth_token");
    vi.unstubAllGlobals();
  });

  it("reports a failed stream so the poll carries on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, body: null }));
    const err = await new Promise<unknown>((resolve) => { streamRunEvents("v1", () => {}, resolve); });
    expect(String(err)).toContain("503");
    vi.unstubAllGlobals();
  });
});

describe("new since baseline drill", () => {
  it("is the baseline run on the Fix work URL", () => {
    expect(fixHref({ run: "v2", module: "material_master", since: "v1" })).toBe("/fix?run=v2&module=material_master&since=v1");
  });
});
