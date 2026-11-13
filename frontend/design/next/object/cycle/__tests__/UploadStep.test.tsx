import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { RoundTripResult } from "@/lib/api/v2/roundtrip";
import type { ObjectRun } from "../../useObjectRun";
import { UploadStep } from "../UploadStep";

vi.mock("@/lib/v2/hooks", () => ({ useV2Session: () => ({ can: () => true }) }));

const o = { module: "material_master", heads: [] } as unknown as ObjectRun;
const row = (n: number) => ({ sheet: "Records to clean", row: n + 2, table: "MARA", key: `MATNR=${n}`, field: "MTART", reason: "No record in the run has this key." });

function drop(upload: (f: File, p?: string) => Promise<RoundTripResult>) {
  const { container } = renderWithQuery(<UploadStep o={o} upload={upload} onScored={() => undefined} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "cleaning.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: /Upload and score/ }));
}

describe("upload step", () => {
  it("shows the reason, the fix and the rejected rows of an upload that applied nothing", async () => {
    const err = { response: { data: { detail: { error: "nothing_applied", detail: "No edit matched a record of the run (25 rows were rejected).", fix: "Download the rejected rows, check the key columns and upload again.", unmatched_rows: Array.from({ length: 25 }, (_, i) => row(i)) } } } };
    drop(() => Promise.reject(err));
    expect((await screen.findByRole("alert")).textContent).toMatch(/No edit matched/);
    expect(screen.getByTestId("upload-fix").textContent).toMatch(/Download the rejected rows/);
    const table = screen.getByTestId("rejected-rows");
    expect(table.querySelectorAll("tbody tr").length).toBe(20);
    expect(table.textContent).toMatch(/Showing 20 of 25 rows/);
    expect(table.textContent).toContain("MATNR=0");
    expect(screen.getByRole("button", { name: "Download the rejected rows" })).toBeTruthy();
  });

  it("lists the rows that matched nothing after a successful upload", async () => {
    const result = { version_id: "v2", job_id: null, status: "pending", parent_version_id: "v1", kind: "cleaning", applied: 3, unchanged: 0, unmatched: 1, unmapped: {}, skipped: {}, no_table: [], no_field: [], unmatched_rows: [row(9)] } satisfies RoundTripResult;
    drop(() => Promise.resolve(result));
    await waitFor(() => expect(screen.getByTestId("upload-result")).toBeTruthy());
    expect(screen.getByTestId("rejected-rows").textContent).toContain("MATNR=9");
    expect(screen.getByTestId("rejected-rows").textContent).toContain("11");
  });
});
