import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { compareVersions } from "@/lib/api/versions";
import { createBatch } from "@/lib/api/remediation";

afterEach(() => vi.restoreAllMocks());

describe("compareVersions", () => {
  it("omits v1 so the API resolves the baseline", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { ok: true } });
    await compareVersions(undefined, "v2", "material_master");
    expect(get).toHaveBeenCalledWith("/api/v1/versions/compare", { params: { v1: undefined, v2: "v2", module: "material_master" } });
  });
});

describe("createBatch", () => {
  it("posts name and filter and returns the created batch", async () => {
    const created = { id: "b1", name: "Regressions MM041 Oct 8", status: "draft", item_count: 12 };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: created });
    const result = await createBatch(created.name, { version_id: "v2", check_id: "MM041", module: "material_master" });
    expect(post).toHaveBeenCalledWith("/api/v1/remediation/batches", {
      name: created.name,
      filter: { version_id: "v2", check_id: "MM041", module: "material_master" },
    });
    expect(result).toEqual(created);
  });
});
