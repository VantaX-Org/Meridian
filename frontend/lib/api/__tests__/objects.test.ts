import { AxiosError } from "axios";
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

  it("getObjects treats a 404 (no completed run yet) as an empty list", async () => {
    mockedGet.mockRejectedValue(new AxiosError("nf", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 404, statusText: "Not Found", data: { detail: "No completed run yet" }, headers: {}, config: {} as never,
    }));
    await expect(getObjects("latest")).resolves.toEqual({ run_id: "", objects: [] });
  });

  it("getObjects still throws on a server error", async () => {
    mockedGet.mockRejectedValue(new AxiosError("boom", "ERR_BAD_RESPONSE", undefined, undefined, {
      status: 500, statusText: "Server Error", data: {}, headers: {}, config: {} as never,
    }));
    await expect(getObjects("latest")).rejects.toThrow("boom");
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
