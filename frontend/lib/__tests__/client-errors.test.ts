import { beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { clientErrorId, reportClientError, resetClientErrorGuard } from "../client-errors";

describe("reportClientError", () => {
  const post = vi.spyOn(apiClient, "post");

  beforeEach(() => {
    resetClientErrorGuard();
    post.mockReset();
    post.mockResolvedValue({ data: { status: "recorded" } });
  });

  it("posts the documented body to the client-errors endpoint", () => {
    reportClientError(new Error("boom"), { digest: "d1", pathname: "/objects" });
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe("/api/v1/client-errors");
    expect(body).toMatchObject({ digest: "d1", message: "boom", pathname: "/objects" });
    expect(typeof body.user_agent).toBe("string");
    expect(Number.isNaN(Date.parse(body.time as string))).toBe(false);
  });

  it("reports each digest once per session", () => {
    reportClientError(new Error("boom"), { digest: "d1" });
    reportClientError(new Error("boom again"), { digest: "d1" });
    reportClientError(new Error("other"), { digest: "d2" });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("derives a stable id when the framework gives none", () => {
    const err = new Error("same");
    expect(clientErrorId(err)).toBe(clientErrorId(err));
    reportClientError(err);
    reportClientError(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("accepts non-Error rejection reasons", () => {
    reportClientError("plain string");
    expect(post.mock.calls[0]?.[1]).toMatchObject({ message: "plain string" });
  });

  it("never throws, even when the request fails", async () => {
    post.mockRejectedValue(new Error("offline"));
    expect(() => reportClientError(new Error("x"), { digest: "d9" })).not.toThrow();
    await Promise.resolve();
  });
});
