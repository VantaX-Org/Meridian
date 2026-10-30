import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadApiClient } from "@/lib/api/client";
import { exportQueryOf, readState } from "@/lib/v2/work";
import { exportFixSheet, exportFixSheetByObject } from "./work";

const BATCH = "6f1c2a7e-0d4b-4c8e-9a51-3b2f7d9e1c04";

/** The URL a call to the upload client asks for, built the way axios builds it. */
const urlOf = (spy: ReturnType<typeof vi.spyOn>, i = 0): URL => {
  const [path, config] = spy.mock.calls[i] as [string, { params?: Record<string, unknown> }];
  return new URL(uploadApiClient.getUri({ url: path, params: config.params }), "http://meridian.test");
};

describe("fix-sheet exports carry the ledger's batch, policy and sort", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    window.sessionStorage.removeItem("mn_v2_fixture");
    window.URL.createObjectURL = vi.fn(() => "blob:x");
    window.URL.revokeObjectURL = vi.fn();
    spy = vi.spyOn(uploadApiClient, "get").mockResolvedValue({ data: new Blob(["x"]), headers: { "content-disposition": 'attachment; filename="fix-sheet.xlsx"' } });
  });
  afterEach(() => vi.restoreAllMocks());

  const state = readState(new URLSearchParams(`batch=${BATCH}&policy=sox:vendor_bank&sort=due&module=accounts_payable`));

  it("GET /work/export", async () => {
    await exportFixSheet(exportQueryOf(state));
    const url = urlOf(spy);
    expect(url.pathname).toBe("/api/v1/work/export");
    expect(url.searchParams.get("batch_id")).toBe(BATCH);
    expect(url.searchParams.get("policy")).toBe("sox:vendor_bank");
    expect(url.searchParams.get("sort")).toBe("due,-value");
    expect(url.searchParams.get("module")).toBe("accounts_payable");
    expect(url.searchParams.get("scope")).toBe("current");
  });

  it("GET /work/export/per-object", async () => {
    await exportFixSheetByObject(exportQueryOf(state));
    const url = urlOf(spy);
    expect(url.pathname).toBe("/api/v1/work/export/per-object");
    expect(url.searchParams.get("batch_id")).toBe(BATCH);
    expect(url.searchParams.get("policy")).toBe("sox:vendor_bank");
    expect(url.searchParams.get("sort")).toBe("due,-value");
  });

  it("the default order is value at risk, highest first, and a past run is never sent", async () => {
    await exportFixSheet(exportQueryOf(readState(new URLSearchParams("as_of_run=r-1"))));
    const url = urlOf(spy);
    expect(url.searchParams.get("sort")).toBe("-value,severity");
    expect(url.searchParams.has("as_of_run")).toBe(false);
    expect(url.searchParams.has("batch_id")).toBe(false);
    expect(url.searchParams.has("policy")).toBe(false);
  });
});
