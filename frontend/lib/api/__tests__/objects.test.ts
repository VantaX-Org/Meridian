import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  default: { get: vi.fn() },
}));

import apiClient from "../client";
import { getObject, getObjectRecord, getObjects } from "../v1/objects";

const mockedGet = vi.mocked(apiClient.get);

describe("objects.ts", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it("getObjects calls /api/v1/objects with the run id", async () => {
    mockedGet.mockResolvedValue({ data: { run_id: "v1", objects: [] } });
    await getObjects("v1");
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/objects", { params: { run: "v1" } });
  });

  it("getObject calls /api/v1/objects/{module} with the run id", async () => {
    mockedGet.mockResolvedValue({ data: {} });
    await getObject("material_master", "v1");
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/objects/material_master", { params: { run: "v1" } });
  });

  it("getObjectRecord encodes the key and forwards optional params", async () => {
    mockedGet.mockResolvedValue({ data: {} });
    await getObjectRecord("material_master", "1000/01", { plant: "1000" });
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/objects/material_master/records/1000%2F01", {
      params: { plant: "1000" },
    });
  });
});
