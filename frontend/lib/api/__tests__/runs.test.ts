import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  default: { get: vi.fn() },
}));

import apiClient from "../client";
import { getRunSteps } from "../v1/runs";

const mockedGet = vi.mocked(apiClient.get);

describe("runs.ts", () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it("getRunSteps calls /api/v1/runs/{id}/steps", async () => {
    mockedGet.mockResolvedValue({ data: { version_id: "v1", steps: [] } });
    await getRunSteps("v1");
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/runs/v1/steps");
  });
});
