import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/z-objects";
import { CustomObjectsTab } from "../custom-objects-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems/s1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions", () => ({ downloadCsv: vi.fn() }));

const ENTRY: api.ZRegistryEntry = {
  id: "z1", category: "table", module: "fi_gl", object_name: "ZFI_SPLIT", standard_equivalent: null, description: "Splits postings",
  owner: "ana", created_date: null, last_active_date: null, status: "active", transaction_count_total: 10, rules_applied: [], notes: null,
};
const ANOMALY: api.ZAnomaly = {
  id: "a1", object_name: "ZFI_SPLIT", anomaly_type: "volume_spike", severity: "high", description: "Volume tripled",
  baseline_value: "10", current_value: "30", deviation_pct: 200, status: "active",
};

beforeEach(() => {
  vi.spyOn(api, "getZRegistry").mockResolvedValue({ total: 1, entries: [ENTRY] });
  vi.spyOn(api, "getZAnomalies").mockResolvedValue({ run_id: "r1", total: 1, anomalies: [ANOMALY] });
  vi.spyOn(api, "getZProfile").mockRejectedValue(new Error("none"));
});
afterEach(() => vi.restoreAllMocks());

describe("CustomObjectsTab", () => {
  it("Detect now queues detection for the system", async () => {
    const detect = vi.spyOn(api, "detectZObjectsNow").mockResolvedValue({ queued: true, version_id: "v1" });
    renderWithQuery(<CustomObjectsTab systemId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "Detect now" }));
    await waitFor(() => expect(detect).toHaveBeenCalledWith("s1"));
  });

  it("edits a registry row in the drawer", async () => {
    const update = vi.spyOn(api, "updateZRegistryEntry").mockResolvedValue({ ...ENTRY, owner: "bo" });
    renderWithQuery(<CustomObjectsTab systemId="s1" />);
    await userEvent.click(await screen.findByText("ZFI_SPLIT"));
    const owner = await screen.findByLabelText("Owner");
    await userEvent.clear(owner);
    await userEvent.type(owner, "bo");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toBe("z1");
    expect(update.mock.calls[0][1]).toMatchObject({ owner: "bo", description: "Splits postings", status: "active" });
  });

  it("sends anomaly feedback from the Expected and Investigate buttons", async () => {
    const fb = vi.spyOn(api, "submitZAnomalyFeedback").mockResolvedValue({ ...ANOMALY, status: "dismissed" });
    renderWithQuery(<CustomObjectsTab systemId="s1" />);
    await userEvent.click(await screen.findByRole("tab", { name: "Anomalies" }));
    await userEvent.click(await screen.findByRole("button", { name: "Expected" }));
    await waitFor(() => expect(fb).toHaveBeenCalledWith("a1", "dismissed"));
    await userEvent.click(await screen.findByRole("button", { name: "Investigate" }));
    await waitFor(() => expect(fb).toHaveBeenCalledWith("a1", "confirmed"));
  });

  it("creates a Z rule from the Rules sub-tab", async () => {
    vi.spyOn(api, "getZRules").mockResolvedValue({ templates: [], custom_rules: [] });
    const create = vi.spyOn(api, "createZRule").mockResolvedValue({ id: "r1", status: "created" });
    renderWithQuery(<CustomObjectsTab systemId="s1" />);
    await userEvent.click(await screen.findByRole("tab", { name: "Rules" }));
    await userEvent.click(await screen.findByRole("button", { name: "New Z rule" }));
    await userEvent.type(await screen.findByLabelText("Rule name"), "Split must balance");
    await userEvent.type(screen.getByLabelText("Condition"), "ZZAMOUNT > 0");
    await userEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ rule_name: "Split must balance", custom_condition: "ZZAMOUNT > 0", severity: "medium" }));
  });

  it("lists the standard-field mapping", async () => {
    vi.spyOn(api, "getZMapping").mockResolvedValue({ total: 1, mappings: [{ object_name: "ZZREF", module: "fi_gl", standard_equivalent: "BKPF.XBLNR", confidence: 0.8, mapping_source: "auto" }] });
    renderWithQuery(<CustomObjectsTab systemId="s1" />);
    await userEvent.click(await screen.findByRole("tab", { name: "Mapping" }));
    expect(await screen.findByText("BKPF.XBLNR")).toBeInTheDocument();
  });

  it("opens the report and downloads it as CSV", async () => {
    vi.spyOn(api, "getZReport").mockResolvedValue({
      total_z_objects: 3, by_status: { active: 3 }, by_module: { fi_gl: 3 }, by_category: { table: 3 },
      active_anomalies: 1, ghost_objects: 0, dormant_objects: 1, mapped_to_standard: 2, unmapped: 1,
    });
    const { downloadCsv } = await import("@/lib/actions");
    renderWithQuery(<CustomObjectsTab systemId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "Report" }));
    const report = await screen.findByTestId("z-report");
    expect(within(report).getByText("Mapped to standard")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(downloadCsv).toHaveBeenCalledWith("custom-object-report.csv", expect.arrayContaining([{ measure: "Custom objects", value: 3 }]));
  });
});
