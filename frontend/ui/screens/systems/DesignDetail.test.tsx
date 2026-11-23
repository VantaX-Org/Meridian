import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as design from "@/lib/api/v2/design";
import { ConfigList, DiffCard, TableSheet } from "./DesignDetail";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/design", async (orig) => ({ ...(await orig<typeof design>()), getDesignDiff: vi.fn(), getDesignTable: vi.fn() }));

const ID = "a1b2c3d4-0001-4000-8000-000000000001";
const snap = (id: string, d: string): design.DesignSnapshot => ({ id, status: "completed", started_at: d, completed_at: d, tables: 3, customer_tables: 1, customer_fields: 2, error: null });
let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/x?fixture=1"); vi.mocked(design.getDesignDiff).mockReset(); vi.mocked(design.getDesignTable).mockReset(); });
afterEach(() => undo());

describe("design detail", () => {
  it("shows a table's fields against the standard", async () => {
    const real = await vi.importActual<typeof design>("@/lib/api/v2/design");
    vi.mocked(design.getDesignTable).mockImplementation(real.getDesignTable);
    const { container } = renderWithQuery(<TableSheet id={ID} table="MARA" onClose={() => undefined} />);
    expect(await screen.findByRole("group", { name: "Table fields" }, { timeout: 5000 })).toBeTruthy();
    expect((await screen.findAllByText(/Differs from the standard/)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
    expect(container).toBeTruthy();
  });

  it("table detail error offers retry", async () => {
    vi.mocked(design.getDesignTable).mockRejectedValueOnce(new Error("boom"));
    renderWithQuery(<TableSheet id={ID} table="MARA" onClose={() => undefined} />);
    expect(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 })).toBeTruthy();
  });

  it("lists configuration tables, empty state when none", async () => {
    renderWithQuery(<ConfigList id={ID} rows={[{ table: "T134", scope: "material_master", rows: 52, source: "live", synced_at: "2026-10-28T02:05:00Z" }]} />);
    expect(await screen.findByText("T134")).toBeTruthy();
    renderWithQuery(<ConfigList id={ID} rows={[]} />);
    expect(await screen.findByText("No configuration read yet")).toBeTruthy();
  });

  it("diffs two snapshots and retries on error", async () => {
    vi.mocked(design.getDesignDiff).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ from: "s1", to: "s2", changes: [{ table: "MARA", field: "MATKL", change: "field_changed", diff: { length: [9, 18] } }] });
    renderWithQuery(<DiffCard id={ID} snaps={[snap("s2", "2026-10-28T00:00:00Z"), snap("s1", "2026-10-20T00:00:00Z")]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 }));
    expect(await screen.findByText("Field changed", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText(/length: 9 to 18/)).toBeTruthy();
  });

  it("diff needs two reads", () => {
    renderWithQuery(<DiffCard id={ID} snaps={[snap("s1", "2026-10-20T00:00:00Z")]} />);
    expect(screen.getByText("Nothing to compare")).toBeTruthy();
  });
});
