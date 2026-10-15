import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { MonitorTab } from "../monitor-tab";
import * as remediationApi from "@/lib/api/remediation";
import * as systemsApi from "@/lib/api/systems";
import type { MonitorItem } from "@/lib/api/remediation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/fix",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const item: MonitorItem = {
  scope: "sys1", system_name: "ECC Prod",
  baseline: { id: "v1", run_at: "2026-01-01T00:00:00Z", dqs: 90 },
  latest: { id: "v2", run_at: "2026-01-05T00:00:00Z", dqs: 85 },
  monitor: {
    baseline_id: "v1", baseline_run_at: "2026-01-01T00:00:00Z", new_records: 4,
    regressed_checks: [{ check_id: "AP001", module: "business_partner", severity: "high", new: 4 }], regressed_check_count: 1, resolved_records: 2,
    batch_id: "b1", batch_items: 4, batch_auto_approvable: 2,
  },
};

describe("MonitorTab", () => {
  it("shows the regressed rule, the drafted batch and the schedule for a monitored system", async () => {
    vi.spyOn(remediationApi, "getMonitor").mockResolvedValue({ items: [item] });
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([
      { id: "p1", system_id: "sys1", domain: "business_partner", tables: [], schedule_cron: "0 2 * * *", active: true, last_run_at: null, next_run_at: "2099-01-01T02:00:00Z", extraction_mode: "delta" },
    ]);
    renderWithQuery(<MonitorTab />);
    expect(await screen.findByText("ECC Prod")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AP001" })).toHaveAttribute("href", "/rules/AP001");
    expect(screen.getByRole("link", { name: /4 regressed records drafted into a fix batch/ })).toHaveAttribute("href", "/fix?tab=batches&batch=b1");
    expect(await screen.findByText(/Re-checks daily at 02:00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-check now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pin latest as baseline" })).toBeInTheDocument();
  });

  it("explains how to start monitoring when nothing is pinned", async () => {
    vi.spyOn(remediationApi, "getMonitor").mockResolvedValue({ items: [] });
    renderWithQuery(<MonitorTab />);
    expect(await screen.findByText("Nothing is being monitored")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open runs" })).toHaveAttribute("href", "/runs");
  });
});
