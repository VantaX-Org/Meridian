// frontend/lib/__tests__/error-reason.test.ts
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";
import { apiErrorDetail, apiErrorReason, isNotFound } from "../error";

function axios404(data: unknown) {
  return new AxiosError("not found", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 404, data, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
  });
}

describe("apiErrorReason", () => {
  it("reads the machine reason out of a structured detail", () => {
    const e = axios404({ detail: { reason: "no_baseline", message: "No earlier run of this system" } });
    expect(apiErrorReason(e)).toBe("no_baseline");
    expect(isNotFound(e)).toBe(true);
  });
  it("is null for a plain string detail, a list detail or a non-axios error", () => {
    expect(apiErrorReason(axios404({ detail: "Version not found" }))).toBeNull();
    expect(apiErrorDetail(axios404({ detail: "Version not found" }))).toBe("Version not found");
    expect(apiErrorReason(axios404({ detail: [{ msg: "x" }] }))).toBeNull();
    expect(apiErrorReason(new Error("boom"))).toBeNull();
  });
});
