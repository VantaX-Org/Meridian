import { describe, expect, it } from "vitest";
import { parseRecordKey } from "./record-key";

describe("parseRecordKey", () => {
  it("treats a bare key as the primary with no fields", () => {
    expect(parseRecordKey("000000000000000101")).toEqual({ fields: {}, primary: "000000000000000101" });
  });

  it("splits a composite key into fields and takes MATNR as the primary", () => {
    expect(parseRecordKey("MATNR=000000000000000101|WERKS=3000")).toEqual({
      fields: { MATNR: "000000000000000101", WERKS: "3000" },
      primary: "000000000000000101",
    });
  });

  it("falls back to the first field when there is no MATNR", () => {
    expect(parseRecordKey("PARTNER=42|BUKRS=1000").primary).toBe("42");
  });

  it("keeps '=' inside a value", () => {
    expect(parseRecordKey("MATNR=A=B").fields.MATNR).toBe("A=B");
  });
});
