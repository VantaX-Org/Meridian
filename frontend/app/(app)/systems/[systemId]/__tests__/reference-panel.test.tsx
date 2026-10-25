import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemObjectsApi from "@/lib/api/system-objects";
import { ReferencePanel } from "../reference-panel";

// The panel captures the upload functions when the module loads, so they are replaced at import, not spied on.
vi.mock("@/lib/api/system-objects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/system-objects")>()),
  uploadPostalCodes: vi.fn(),
  uploadBicDirectory: vi.fn(),
}));

const csv = (name: string) => new File(["country,postcode\nZA,2000\n"], name, { type: "text/csv" });

describe("reference lists", () => {
  it("asks before replacing a loaded list, naming its size and countries", async () => {
    vi.spyOn(systemObjectsApi, "getReferenceLists").mockResolvedValue([{ kind: "postal-codes", records: 12500, countries: ["ZA", "NA"] }]);
    const upload = vi.mocked(systemObjectsApi.uploadPostalCodes).mockResolvedValue({ kind: "postal-codes", records: 3, countries: ["ZA"] });
    renderWithQuery(<ReferencePanel id="s1" />);
    const input = await screen.findByTestId("postal-codes-file");
    fireEvent.change(input, { target: { files: [csv("codes-2026.csv")] } });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/The current list of 12,500 codes for ZA, NA is replaced by codes-2026\.csv/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace list" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "codes-2026.csv" })));
  });

  it("keeps the current list when the replacement is cancelled", async () => {
    vi.spyOn(systemObjectsApi, "getReferenceLists").mockResolvedValue([{ kind: "bic", records: 40, countries: ["ZA"] }]);
    const upload = vi.mocked(systemObjectsApi.uploadBicDirectory).mockResolvedValue({ kind: "bic", records: 1, countries: ["ZA"] });
    renderWithQuery(<ReferencePanel id="s1" />);
    fireEvent.change(await screen.findByTestId("bic-file"), { target: { files: [csv("bic.csv")] } });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/40 BICs for ZA/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep the current list" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads a first list without asking", async () => {
    vi.spyOn(systemObjectsApi, "getReferenceLists").mockResolvedValue([]);
    const upload = vi.mocked(systemObjectsApi.uploadPostalCodes).mockResolvedValue({ kind: "postal-codes", records: 3, countries: ["ZA"] });
    renderWithQuery(<ReferencePanel id="s1" />);
    fireEvent.change(await screen.findByTestId("postal-codes-file"), { target: { files: [csv("codes.csv")] } });
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
