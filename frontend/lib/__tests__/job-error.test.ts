import { describe, expect, it } from "vitest";
import { explainJobError } from "../job-error";

const kind = (raw: string) => explainJobError(raw)?.kind;

describe("explainJobError", () => {
  it("reads nothing as no error", () => {
    expect(explainJobError(null)).toBeNull();
    expect(explainJobError("   ")).toBeNull();
  });

  it("recognises a sign-in SAP refused", () => {
    expect(kind("RFC_LOGON_FAILURE: Name or password is incorrect (repeat logon)")).toBe("auth");
    expect(kind("HTTPError: 401 Client Error: Unauthorized for url")).toBe("auth");
    expect(kind("403 Forbidden")).toBe("auth");
    expect(kind("invalid_client")).toBe("auth");
  });

  it("recognises a missing table authorisation before a refused sign-in", () => {
    expect(kind("RFC_NO_AUTHORITY: User MERIDIAN has no RFC authorization for function module RFC_READ_TABLE")).toBe("authority");
    expect(kind("Not authorized for table BSEG")).toBe("authority");
    expect(kind("missing authorization S_TABU_DIS")).toBe("authority");
  });

  it("recognises an unreachable host", () => {
    expect(kind("ConnectionRefusedError: [Errno 111] Connection refused")).toBe("unreachable");
    expect(kind("RFC_COMMUNICATION_FAILURE: partner 'sap01:3300' not reached")).toBe("unreachable");
    expect(kind("[Errno -3] Temporary failure in name resolution")).toBe("unreachable");
    expect(kind("Network is unreachable")).toBe("unreachable");
  });

  it("recognises a timeout", () => {
    expect(kind("SoftTimeLimitExceeded()")).toBe("timeout");
    expect(kind("ReadTimeout: read timed out")).toBe("timeout");
  });

  it("recognises the missing RFC library", () => {
    expect(kind("pyrfc_not_installed: build the wheel")).toBe("library");
  });

  it("falls back to a plain sentence and keeps the raw text as the detail", () => {
    const e = explainJobError("KeyError: 'MATNR'");
    expect(e).toMatchObject({ kind: "other", summary: "The job stopped with an error", detail: "KeyError: 'MATNR'" });
    expect(e?.next).toMatch(/technical detail/);
  });
});
