import { describe, expect, it } from "vitest";
import { checkCleaned, gate, tally, type CleanedInput, type UploadCheck } from "../uploadGate";

const row = (over: Record<string, string> = {}) => ({ "Record key": "K1", Field: "Plant", "Current value": "A", "Corrected value": "B", ...over });
const base = (over: Partial<CleanedInput> = {}): CleanedInput => ({
  headers: ["Record key", "Field", "Current value", "Corrected value", "Required field empty"],
  rows: [row()],
  exportedRows: 1,
  allowed: {},
  ...over,
});
const status = (cs: UploadCheck[], id: string) => cs.find((c) => c.id === id)?.status;

describe("upload checks", () => {
  it("passes a clean workbook", () => {
    const cs = checkCleaned(base());
    expect(cs.every((c) => c.status === "pass")).toBe(true);
    expect(gate(cs, false)).toMatchObject({ state: "ready", canUpload: true });
  });
  it("fails when a required column is missing", () => {
    expect(status(checkCleaned(base({ headers: ["Field"] })), "structure")).toBe("fail");
  });
  it("fails an edit with no record key", () => {
    expect(status(checkCleaned(base({ rows: [row({ "Record key": "" })] })), "keys")).toBe("fail");
  });
  it("warns about a value outside the allowed list", () => {
    const cs = checkCleaned(base({ allowed: { Plant: ["X", "Y"] } }));
    expect(status(cs, "domain")).toBe("warn");
  });
  it("fails a required field blanked with spaces", () => {
    expect(status(checkCleaned(base({ rows: [row({ "Required field empty": "Yes", "Corrected value": "  " })] })), "mandatory")).toBe("fail");
  });
  it("fails when rows were deleted", () => {
    expect(status(checkCleaned(base({ exportedRows: 3 })), "deleted")).toBe("fail");
  });
  it("counts changed, unchanged and rejected rows", () => {
    const input = base({ rows: [row(), row({ "Record key": "K2", "Corrected value": "A" }), row({ "Record key": "" })] });
    expect(tally(input, checkCleaned(input))).toEqual({ changed: 1, unchanged: 1, rejected: 1 });
  });
});

describe("upload gate", () => {
  const pass: UploadCheck = { id: "keys", status: "pass", count: 0 };
  const warn: UploadCheck = { id: "domain", status: "warn", count: 2 };
  const fail: UploadCheck = { id: "deleted", status: "fail", count: 4 };
  it("a fail blocks even when confirmed", () => {
    expect(gate([pass, warn, fail], true)).toMatchObject({ state: "blocked", canUpload: false });
  });
  it("a warning needs a confirm", () => {
    expect(gate([pass, warn], false)).toMatchObject({ state: "confirm", canUpload: false });
    expect(gate([pass, warn], true)).toMatchObject({ state: "confirm", canUpload: true });
  });
  it("all passes go through", () => {
    expect(gate([pass], false).canUpload).toBe(true);
  });
});
