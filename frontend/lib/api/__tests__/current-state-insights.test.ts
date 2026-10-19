import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { getCurrentCleansing, getCurrentOverview, getCurrentRootCauses } from "@/lib/api/insights";
import { getCurrentS4Readiness, getS4Readiness } from "@/lib/api/migration";

afterEach(() => vi.restoreAllMocks());

describe("current-state insight wrappers", () => {
  it("ask the one-run endpoints for scope=current, never a version_id", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { version_id: null, scope: "current" } });
    await getCurrentOverview();
    await getCurrentRootCauses({ module: "accounts_payable" });
    await getCurrentCleansing();
    await getCurrentS4Readiness();
    expect(get.mock.calls).toEqual([
      ["/api/v1/insights/overview", { params: { scope: "current" } }],
      ["/api/v1/insights/root-causes", { params: { module: "accounts_payable", scope: "current" } }],
      ["/api/v1/insights/cleansing", { params: { scope: "current" } }],
      ["/api/v1/findings/s4-readiness", { params: { scope: "current" } }],
    ]);
  });

  it("leave the one-run S/4 call as it was", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { version_id: "v1" } });
    await getS4Readiness("v1");
    expect(get).toHaveBeenCalledWith("/api/v1/findings/s4-readiness", { params: { version_id: "v1" } });
  });
});
