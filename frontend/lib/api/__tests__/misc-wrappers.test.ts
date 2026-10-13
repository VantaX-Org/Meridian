import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

import apiClient from "../client";
import { getMiningAnomalies, getMiningDuplicates, getMiningRelationships } from "../mining";
import { sendOwnerDigests } from "../owners";
import { pptxExportUrl } from "../process-designer";
import { createBatchFromSimulation } from "../remediation";
import { getS4Readiness } from "../migration";

const client = vi.mocked(apiClient);

beforeEach(() => {
  client.get.mockReset().mockResolvedValue({ data: {} });
  client.post.mockReset().mockResolvedValue({ data: {} });
});

describe("process exports", () => {
  it("builds the PowerPoint urls for the reference and a model", () => {
    expect(pptxExportUrl("reference")).toBe("/api/v1/process-designer/reference/export/pptx");
    expect(pptxExportUrl("m1")).toBe("/api/v1/process-designer/models/m1/export/pptx");
    expect(pptxExportUrl("m1", 3)).toBe("/api/v1/process-designer/models/m1/export/pptx?version=3");
  });
});

describe("what-if", () => {
  it("creates a batch from a simulation", async () => {
    await createBatchFromSimulation("Fixes", "s1");
    expect(client.post).toHaveBeenCalledWith("/api/v1/remediation/batches/from-simulation", { name: "Fixes", simulation_id: "s1" });
  });
});

describe("owners", () => {
  it("sends digests to one owner or everyone", async () => {
    await sendOwnerDigests({ owner: "P. Naidoo" });
    expect(client.post).toHaveBeenCalledWith("/api/v1/owners/digests/send", { owner: "P. Naidoo" });
    await sendOwnerDigests({});
    expect(client.post).toHaveBeenLastCalledWith("/api/v1/owners/digests/send", {});
  });
});

describe("mining", () => {
  it("reads duplicates, anomalies and relationships", async () => {
    await getMiningDuplicates({ version_id: "v1" });
    await getMiningAnomalies({ version_id: "v1" });
    await getMiningRelationships({ version_id: "v1" });
    expect(client.get.mock.calls.map((c) => c[0])).toEqual(["/api/v1/mining/duplicates", "/api/v1/mining/anomalies", "/api/v1/mining/relationships"]);
  });
});

describe("s4 readiness", () => {
  it("reads the readiness of one version", async () => {
    await getS4Readiness("v1");
    expect(client.get).toHaveBeenCalledWith("/api/v1/findings/s4-readiness", { params: { version_id: "v1" } });
  });
});
