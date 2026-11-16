import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { UploadChecks } from "@/lib/api/v2/roundtrip";
import { CleanedUpload } from "../CleanedUpload";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const warn: UploadChecks = {
  verdict: "warn", parent_version_id: "v1", latest_version_id: null, edits: 3,
  checks: [{ id: "values", status: "warn", detail: "1 flagged value(s) are left out; the rest fit the field definitions." }],
  flagged: [{ table: "MARA", key: "000000000000000042", field: "MATKL", description: "Material Group", reason: "long" }],
  flagged_total: 1,
};
const check = vi.fn<(f: File, p?: string, m?: string, skip?: boolean) => Promise<UploadChecks>>(async () => warn);
vi.mock("@/lib/api/v2/upload-checks", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/v2/upload-checks")>()),
  checkWorkbook: (f: File, p?: string, m?: string, s?: boolean) => check(f, p, m, s),
}));
const upload = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ version_id: "v2", job_id: null, status: "pending", parent_version_id: "v1", kind: "template", applied: 2, unchanged: 0, unmatched: 0, unmapped: {}, skipped: {}, no_table: [], no_field: [] }));
vi.mock("@/lib/api/v2/roundtrip", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/v2/roundtrip")>()),
  uploadCleaned: (...a: unknown[]) => upload(...a),
}));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/objects/material_master?fixture=1");
  check.mockClear();
  upload.mockClear();
});
afterEach(() => window.sessionStorage.clear());

describe("CleanedUpload", () => {
  it("checks the file first, lists flagged cells with their description, and holds the upload until warnings are confirmed", async () => {
    const u = userEvent.setup();
    renderWithQuery(<CleanedUpload module="material_master" label="Material master" />);
    await u.upload(screen.getByLabelText(/Cleaned file/), new File(["x"], "clean.xlsx"));
    const table = await screen.findByTestId("cleaned-flagged");
    expect(table).toHaveTextContent("MATKL");
    expect(table).toHaveTextContent("Material Group");
    expect(table).toHaveTextContent("Longer than the field allows");
    const send = screen.getByRole("button", { name: "Upload cleaned file" });
    expect(send).toBeDisabled();

    await u.click(screen.getByTestId("cleaned-skip-flagged"));
    await waitFor(() => expect(check).toHaveBeenLastCalledWith(expect.any(File), undefined, undefined, true));
    await u.click(await screen.findByTestId("cleaned-confirm"));
    await waitFor(() => expect(send).toBeEnabled());
    await u.click(send);
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File), undefined, undefined, true, true));
  });

  it("blocks a file whose checks fail", async () => {
    check.mockResolvedValueOnce({ ...warn, verdict: "fail", checks: [{ id: "columns", status: "fail", detail: "" }], flagged: [] });
    const u = userEvent.setup();
    renderWithQuery(<CleanedUpload module="material_master" label="Material master" />);
    await u.upload(screen.getByLabelText(/Cleaned file/), new File(["x"], "clean.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent("A check failed");
    expect(screen.getByRole("button", { name: "Upload cleaned file" })).toBeDisabled();
    expect(upload).not.toHaveBeenCalled();
  });
});
