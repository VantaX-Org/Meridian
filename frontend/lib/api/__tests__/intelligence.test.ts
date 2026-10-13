import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

import apiClient from "../client";
import {
  discoverConfigNow, getConfigAlignmentByModule, getConfigInventoryByModule, getConfigRootCause,
} from "../config-intelligence";
import {
  createZRule, detectZObjectsNow, getZMapping, getZReport, getZRules, submitZAnomalyFeedback, updateZRegistryEntry,
} from "../z-objects";

const client = vi.mocked(apiClient);

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: {} });
  client.post.mockReset().mockResolvedValue({ data: {} });
  client.put.mockReset().mockResolvedValue({ data: {} });
});

describe("z-object wrappers", () => {
  it("detect queues the latest stored data, scoped to a system", async () => {
    await detectZObjectsNow("s1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/z-objects/detect/latest", null, { params: { system_id: "s1" } });
  });

  it("registry update puts the patch", async () => {
    await updateZRegistryEntry("z 1", { owner: "ana", status: "under_review" });
    expect(client.put).toHaveBeenCalledWith("/api/v1/z-objects/registry/z%201", { owner: "ana", status: "under_review" });
  });

  it("anomaly feedback posts the verdict", async () => {
    await submitZAnomalyFeedback("a1", "dismissed");
    expect(client.post).toHaveBeenCalledWith("/api/v1/z-objects/anomalies/a1/feedback", { status: "dismissed" });
  });

  it("rules, report and mapping read their endpoints", async () => {
    await getZRules();
    await getZReport();
    await getZMapping();
    expect(client.get.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/z-objects/rules", "/api/v1/z-objects/report", "/api/v1/z-objects/mapping",
    ]);
  });

  it("creates a rule", async () => {
    const body = { rule_name: "x", custom_condition: "y", severity: "low" as const };
    await createZRule(body);
    expect(client.post).toHaveBeenCalledWith("/api/v1/z-objects/rules", body);
  });
});

describe("config intelligence wrappers", () => {
  it("per-module reads encode the module", async () => {
    await getConfigInventoryByModule("fi_gl");
    await getConfigAlignmentByModule("fi gl");
    expect(client.get.mock.calls.map((c) => c[0])).toEqual(["/api/v1/config/inventory/fi_gl", "/api/v1/config/alignment/fi%20gl"]);
  });

  it("root cause passes the run", async () => {
    await getConfigRootCause("CFG-1", "v1");
    expect(client.get).toHaveBeenCalledWith("/api/v1/config/root-cause/CFG-1", { params: { run_id: "v1" } });
  });

  it("discover queues the latest stored data", async () => {
    await discoverConfigNow("s1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/config/discover/latest", null, { params: { system_id: "s1" } });
  });
});
