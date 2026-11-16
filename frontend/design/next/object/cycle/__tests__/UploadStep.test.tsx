import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { RoundTripResult } from "@/lib/api/v2/roundtrip";
import type { UploadChecks } from "@/lib/api/v2/upload-checks";
import type { ObjectRun } from "../../useObjectRun";
import { BeforeAfter, UploadStep } from "../UploadStep";

vi.mock("@/lib/v2/hooks", () => ({ useV2Session: () => ({ can: () => true }), useV2Href: () => (p: string) => p }));

// null lets the fixture answer; a value replaces the pre-upload check result
let checks: UploadChecks | null = null;
const checkCalls: boolean[] = [];
vi.mock("@/lib/api/v2/upload-checks", async (orig) => {
  const real = await orig<typeof import("@/lib/api/v2/upload-checks")>();
  return {
    ...real,
    checkWorkbook: (file: File, p?: string, m?: string, skip = false) => {
      checkCalls.push(skip);
      return checks ? Promise.resolve(checks) : real.checkWorkbook(file, p, m, skip);
    },
  };
});

let rules: { check_id: string; dimension: string; affected_count: number; field: string | null; field_description?: string }[] = [];
vi.mock("@/lib/v2/runs-queries", async (orig) => ({
  ...(await orig<typeof import("@/lib/v2/runs-queries")>()),
  useScoreDelta: () => ({ isPending: false, isError: false, data: { before: 70, after: 74.5, delta: 4.5, by_dimension: [{ dimension: "completeness", points: 3.2 }] } }),
  useCompareRecords: () => ({ isPending: false, isError: false, data: { totals: { resolved: 12, persisting: 5, new: 1 } } }),
}));
vi.mock("@/lib/v2/queries", async (orig) => ({
  ...(await orig<typeof import("@/lib/v2/queries")>()),
  useObjectRules: () => ({ isPending: false, isError: false, data: rules }),
}));

const o = { module: "material_master", heads: [] } as unknown as ObjectRun;
const row = (n: number) => ({ sheet: "Records to clean", row: n + 2, table: "MARA", key: `MATNR=${n}`, field: "MTART", reason: "No record in the run has this key." });
const ok = { version_id: "v2", job_id: null, status: "pending", parent_version_id: "v1", kind: "cleaning", applied: 3, unchanged: 0, unmatched: 0, unmapped: {}, skipped: {}, no_table: [], no_field: [], unmatched_rows: [] } satisfies RoundTripResult;
const flagged: UploadChecks = { verdict: "pass", checks: [], parent_version_id: "v1", latest_version_id: null, edits: 1, flagged: [{ table: "MARA", key: "MATNR=1", field: "MTART", description: "Material type", reason: "long" }], flagged_total: 1 };

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  checks = null;
  checkCalls.length = 0;
  rules = [];
});

function add(upload: (f: File, p?: string, c?: boolean, s?: boolean) => Promise<RoundTripResult>, run: ObjectRun = o) {
  const { container } = renderWithQuery(<UploadStep o={run} upload={upload} onScored={() => undefined} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "cleaning.xlsx")] } });
}

async function drop(upload: (f: File, p?: string, c?: boolean, s?: boolean) => Promise<RoundTripResult>, run: ObjectRun = o) {
  add(upload, run);
  await screen.findByTestId("check-list");
  fireEvent.click(screen.getByRole("button", { name: /Upload and score/ }));
}

describe("upload step", () => {
  it("shows the reason, the fix and the rejected rows of an upload that applied nothing", async () => {
    const err = { response: { data: { detail: { error: "nothing_applied", detail: "No edit matched a record of the run (25 rows were rejected).", fix: "Download the rejected rows, check the key columns and upload again.", unmatched_rows: Array.from({ length: 25 }, (_, i) => row(i)) } } } };
    await drop(() => Promise.reject(err));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No edit matched/);
    expect(screen.getByTestId("upload-fix").textContent).toMatch(/Download the rejected rows/);
    const table = screen.getByTestId("rejected-rows");
    expect(table.querySelectorAll("tbody tr").length).toBe(20);
    expect(table.textContent).toMatch(/Showing 20 of 25 rows/);
    expect(table.textContent).toContain("MATNR=0");
    expect(screen.getByRole("button", { name: "Download the rejected rows" })).toBeTruthy();
  });

  it("lists the rows that matched nothing after a successful upload", async () => {
    await drop(() => Promise.resolve({ ...ok, unmatched: 1, unmatched_rows: [row(9)] }));
    await waitFor(() => expect(screen.getByTestId("upload-result")).toBeTruthy());
    expect(screen.getByTestId("rejected-rows").textContent).toContain("MATNR=9");
    expect(screen.getByTestId("rejected-rows").textContent).toContain("11");
  });

  it("lists the flagged cells with the field text and sends skip_flagged when they are left out", async () => {
    checks = flagged;
    const upload = vi.fn((...args: [File, string?, boolean?, boolean?]) => { void args; return Promise.resolve(ok); });
    add(upload);
    const cells = await screen.findByTestId("flagged-cells");
    expect(cells.textContent).toContain("MATNR=1");
    expect(cells.textContent).toContain("MTART");
    expect(cells.textContent).toContain("Material type");
    fireEvent.click(screen.getByTestId("skip-flagged").querySelector("input") as HTMLInputElement);
    await waitFor(() => expect(checkCalls).toContain(true));
    await screen.findByTestId("check-list");
    fireEvent.click(screen.getByRole("button", { name: /Upload and score/ }));
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][3]).toBe(true);
  });

  it("links the cleaned version to its agreement check and to a new migration", async () => {
    await drop(() => Promise.resolve(ok), { ...o, systemId: "sys-1" } as ObjectRun);
    const agreement = await screen.findByTestId("upload-to-agreement");
    expect(agreement.getAttribute("href")).toBe("/next/run/v2/agreement");
    expect(screen.getByTestId("upload-to-migration").getAttribute("href")).toBe("/migration?start=1&system=sys-1&source_version=v2");
  });

  it("offers no migration link when the object has no system", async () => {
    await drop(() => Promise.resolve(ok));
    await screen.findByTestId("upload-to-agreement");
    expect(screen.queryByTestId("upload-to-migration")).toBeNull();
  });
});

describe("before and after", () => {
  it("shows the change per dimension and says when no required field is empty", () => {
    renderWithQuery(<BeforeAfter after="v2" before="v1" module="material_master" />);
    expect(screen.getByTestId("before-after").textContent).toContain("74.5 (+4.5)");
    expect(screen.getByTestId("delta-completeness").textContent).toContain("+3.2");
    expect(screen.getByTestId("delta-accuracy").textContent).toMatch(/No change recorded/);
    expect(screen.getByTestId("no-empty-required")).toBeTruthy();
  });

  it("lists the required fields that are still empty with their text", () => {
    rules = [{ check_id: "MM-C-1", dimension: "completeness", affected_count: 8, field: "MEINS", field_description: "Base unit of measure" }];
    renderWithQuery(<BeforeAfter after="v2" before="v1" module="material_master" />);
    const list = screen.getByTestId("empty-required");
    expect(list.textContent).toContain("MEINS");
    expect(list.textContent).toContain("Base unit of measure");
    expect(list.textContent).toMatch(/8 records/);
  });
});
