import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import * as lineage from "@/lib/api/v2/lineage";
import { BlastCard } from "./Blast";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/lineage", async (orig) => ({ ...(await orig<typeof lineage>()), getBlastRadius: vi.fn() }));

const rules = [{ check_id: "MM142", name: "Missing base unit" }, { check_id: "MM003", name: "Bad material type" }];
const real = await vi.importActual<typeof lineage>("@/lib/api/v2/lineage");

beforeEach(() => {
  stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/x?fixture=1");
  vi.mocked(lineage.getBlastRadius).mockReset().mockImplementation(real.getBlastRadius);
});

describe("BlastCard", () => {
  it("shows tiles, the documents chart and the tables reached", async () => {
    renderWithQuery(<BlastCard runId="r1" rules={rules} />);
    expect(await screen.findByRole("group", { name: "Tables reached" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Documents by table" })).toBeTruthy();
    expect(screen.getByText("Failing records")).toBeTruthy();
    expect(screen.getByText("EKPO")).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
  });
  it("loads another rule when picked", async () => {
    renderWithQuery(<BlastCard runId="r1" rules={rules} />);
    await screen.findByRole("group", { name: "Tables reached" });
    fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "MM003" } });
    await vi.waitFor(() => expect(lineage.getBlastRadius).toHaveBeenCalledWith("r1", "MM003"));
  });
  it("shows an empty state when no records reach documents", async () => {
    vi.mocked(lineage.getBlastRadius).mockResolvedValueOnce({ version_id: "r1", check_id: "MM142", grain: "material", object: "material", failing_records: 0, keys_truncated: false, targets: [], steps_touched: [], processes_touched: [] });
    renderWithQuery(<BlastCard runId="r1" rules={rules} />);
    expect(await screen.findByText("This rule has no failing records that reach documents.")).toBeTruthy();
  });
  it("shows an error and retries", async () => {
    vi.mocked(lineage.getBlastRadius).mockRejectedValueOnce(new Error("down"));
    renderWithQuery(<BlastCard runId="r1" rules={rules} />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Tables reached" })).toBeTruthy();
  });
  it("renders nothing without a run", () => {
    const { container } = renderWithQuery(<BlastCard runId={null} rules={rules} />);
    expect(container.textContent).toBe("");
  });
});
