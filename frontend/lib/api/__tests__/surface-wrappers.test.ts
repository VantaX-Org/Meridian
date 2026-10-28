// Wrappers for backend features surfaced in the admin, duplicates and migration pages: the URLs and bodies they send.
import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { getDedupCandidatesByObject } from "../cleaning";
import { createException } from "../exceptions";
import { executeTenantPurge, requestTenantPurge } from "../retention";

afterEach(() => vi.restoreAllMocks());

describe("typed dedup candidates", () => {
  it("reads one object's pairs with its score floor and status", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { items: [], total: 0 } });
    await getDedupCandidatesByObject("material_master", { min_score: 80, status: "pending" });
    expect(get).toHaveBeenCalledWith("/api/v1/dedup/candidates/material_master", { params: { min_score: 80, status: "pending" } });
  });

  it("encodes the object type", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { items: [], total: 0 } });
    await getDedupCandidatesByObject("a/b");
    expect(get.mock.calls[0][0]).toBe("/api/v1/dedup/candidates/a%2Fb");
  });
});

describe("exceptions", () => {
  it("posts the exception body", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { id: "e1", status: "open" } });
    await expect(createException({ type: "dq_rule", category: "data_quality", severity: "high", title: "t", description: "d" })).resolves.toEqual({ id: "e1", status: "open" });
    expect(post).toHaveBeenCalledWith("/api/v1/exceptions", expect.objectContaining({ type: "dq_rule", severity: "high" }));
  });
});

describe("tenant purge", () => {
  it("requests with an empty body and returns the delay token", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { token: "t", executes_after: "2026-10-29T00:00:00Z" } });
    await expect(requestTenantPurge()).resolves.toEqual({ token: "t", executes_after: "2026-10-29T00:00:00Z" });
    expect(post).toHaveBeenCalledWith("/api/v1/admin/purge-tenant", {});
  });

  it("executes with the token and saves the certificate", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: new Blob(["%PDF"]) });
    const create = vi.fn(() => "blob:x");
    Object.assign(window.URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await executeTenantPurge("t");
    expect(post).toHaveBeenCalledWith("/api/v1/admin/purge-tenant", { token: "t" }, { responseType: "blob" });
    expect(click).toHaveBeenCalled();
  });

  it("surfaces the API's sentence from a blob error body", async () => {
    const body = new Blob([JSON.stringify({ detail: { error: "too_early", message: "The purge token is not usable yet." } })]);
    vi.spyOn(apiClient, "post").mockRejectedValue({ response: { status: 409, data: body } });
    await expect(executeTenantPurge("t")).rejects.toThrow("The purge token is not usable yet.");
  });
});
