import { describe, expect, it } from "vitest";
import type { SAPSystemExtended } from "@/types/api";
import { bodyOf, patchOf, valuesOf } from "./ConnectionTab";

const ecc = { id: "s1", name: "Sandbox", system_type: "ecc", host: "sap.internal", client: "100", sysnr: "00", username: "RFCUSER", base_url: null, company_id: null, auth_type: "rfc", environment: "QAS" } as unknown as SAPSystemExtended;

describe("ConnectionTab payloads", () => {
  it("sends nothing when nothing changed", () => {
    expect(patchOf(ecc, valuesOf(ecc))).toEqual({});
  });
  it("sends only the changed field and the secret typed", () => {
    const v = { ...valuesOf(ecc), host: "sap2.internal", password: "pw" };
    expect(patchOf(ecc, v)).toEqual({ host: "sap2.internal", credentials: { password: "pw" } });
  });
  it("test body carries the whole endpoint and no secret when none typed", () => {
    const b = bodyOf(ecc, valuesOf(ecc));
    expect(b).toMatchObject({ host: "sap.internal", client: "100", sysnr: "00", username: "RFCUSER", system_type: "ecc" });
    expect(b.credentials).toEqual({});
  });
});
