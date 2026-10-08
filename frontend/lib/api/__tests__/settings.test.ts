import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));

import apiClient from "../client";
import { getCostModel, updateCostModel } from "../settings";
import type { CostModel } from "@/types/api";

const mockedGet = vi.mocked(apiClient.get);
const mockedPut = vi.mocked(apiClient.put);

describe("settings.ts cost model", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedPut.mockReset();
  });

  it("getCostModel calls GET /api/v1/settings/cost-model and returns the body", async () => {
    const model: CostModel = { currency: "USD", severity: {}, modules: {}, rules: {}, features: { MIGO: 150 } };
    mockedGet.mockResolvedValue({ data: model });
    const result = await getCostModel();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/settings/cost-model");
    expect(result).toEqual(model);
  });

  it("updateCostModel calls PUT /api/v1/settings/cost-model with the model", async () => {
    const model: CostModel = { currency: "USD", severity: {}, modules: {}, rules: {}, features: { VA01: 90 } };
    mockedPut.mockResolvedValue({ data: undefined });
    await updateCostModel(model);
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/settings/cost-model", model);
  });
});
