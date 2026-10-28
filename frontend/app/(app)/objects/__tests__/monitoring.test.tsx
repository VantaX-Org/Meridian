// frontend/app/(app)/objects/__tests__/monitoring.test.tsx
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import ObjectsPage from "../page";

let currentSearch = "run=v1";
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const summary = (module: string, label: string): objectsApi.ObjectSummary =>
  ({ module, label, composite_score: 80, readiness: "warn", failing_checks: 1, affected_records: 10 });
const monitor = (module: string, freshness: objectsApi.Freshness, over: Partial<objectsApi.ObjectMonitor> = {}): objectsApi.ObjectMonitor => ({
  module, system_id: "s1", last_run_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), last_version_id: "v1", trigger: "scheduled", requested_by_label: null,
  cadence: { cron: "0 2 * * *", active: true, interval_seconds: 86_400, profile_id: "p1" }, next_run_at: null, freshness,
  baseline: { kind: "previous", version_id: "v0", run_at: "2026-10-01T00:00:00Z" },
  drift: { new_failing: 7, recovered: 2, newly_failing_rules: [{ check_id: "MM_001" }], recovered_rules: [], newly_failing_rule_count: 2, recovered_rule_count: 0 },
  ...over,
});

const ledger = () => within(screen.getByRole("grid"));
const headers = () => within(screen.getByRole("grid")).getAllByRole("columnheader").map((h) => h.textContent);

beforeEach(() => {
  vi.restoreAllMocks();
  replace.mockClear();
  currentSearch = "run=v1";
  vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [summary("material_master", "Material master"), summary("fi_gl", "FI general ledger")] });
  vi.spyOn(objectsApi, "getObjectsMonitor").mockResolvedValue([monitor("material_master", "stale"), monitor("fi_gl", "fresh")]);
});

describe("Objects list monitoring", () => {
  it("shows a Freshness column in the default view and keeps the work columns", async () => {
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("Stale")).toBeInTheDocument());
    expect(ledger().getByText("Fresh")).toBeInTheDocument();
    expect(headers()).toEqual(expect.arrayContaining(["Freshness", "Rule failures (all rules)", "Score", "Verdict"]));
    expect(headers()).not.toContain("Checked");
    expect(headers()).not.toContain("Cadence");
  });

  it("?view=monitoring is URL state: Checked, Cadence, Freshness and Change beside Score and Verdict, without the work columns", async () => {
    currentSearch = "run=v1&view=monitoring";
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("Stale")).toBeInTheDocument());
    expect(headers()).toEqual(expect.arrayContaining(["Checked", "Cadence", "Freshness", "Change", "Score", "Verdict"]));
    for (const gone of ["Rule failures", "To fix", "Blocking rule", "Owner"]) expect(headers()).not.toContain(gone);
    expect(ledger().getAllByText("2h ago").length).toBeGreaterThan(0);
    expect(ledger().getAllByText("Daily at 02:00").length).toBeGreaterThan(0);
    expect(ledger().getAllByText("+2 failing")[0].closest("[title]")).toHaveAttribute("title", "7 new failing records, 2 recovered records since the baseline");
  });

  it("writes the view to the URL when the Monitoring chip is pressed, and removes it when pressed again", async () => {
    renderWithQuery(<ObjectsPage />);
    const chip = await screen.findByRole("button", { name: "Monitoring" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(replace).toHaveBeenCalledWith("/objects?run=v1&view=monitoring");
  });

  it("filters to stale objects with the Freshness chip, held in ?freshness=", async () => {
    currentSearch = "run=v1&freshness=stale";
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("Stale")).toBeInTheDocument());
    expect(ledger().queryByText("FI general ledger")).toBeNull();
    expect(screen.getByRole("button", { name: "Stale", pressed: true })).toBeInTheDocument();
  });

  it("writes the freshness filter to the URL", async () => {
    renderWithQuery(<ObjectsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Failed" }));
    expect(replace).toHaveBeenCalledWith("/objects?run=v1&freshness=failed");
  });

  it("says First run for an object with no baseline", async () => {
    currentSearch = "run=v1&view=monitoring";
    vi.spyOn(objectsApi, "getObjectsMonitor").mockResolvedValue([monitor("material_master", "fresh", { baseline: { kind: null, version_id: null, run_at: null } })]);
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getAllByText("First run").length).toBeGreaterThan(0));
  });
});
