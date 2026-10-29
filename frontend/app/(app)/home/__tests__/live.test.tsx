// frontend/app/(app)/home/__tests__/live.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as jobsApi from "@/lib/api/jobs";
import type { SAPSystemExtended } from "@/types/api";
import type { Job } from "@/types/jobs";
import * as systemsApi from "@/lib/api/systems";
import { LiveSection, systemRows } from "../_live";

let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/home/basis", useSearchParams: () => new URLSearchParams() }));

const system: SAPSystemExtended = {
  id: "sys-1",
  name: "ECC Prod",
  system_type: "ecc",
  host: "sap.example",
  client: "100",
  sysnr: "00",
  username: "meridian",
  base_url: null,
  company_id: null,
  auth_type: null,
  description: null,
  environment: "PRD",
  is_active: true,
  health_status: "healthy",
  health_message: null,
  last_health_check: null,
  config_last_synced_at: null,
  config_sync_status: null,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  last_sync_at: "2026-10-08T00:00:00Z",
  last_sync_status: "complete",
  discovery_status: null,
  discovered_at: null,
  sap_release: null,
  last_analysis_at: null, role: "source", target_system_id: null,
};

describe("LiveSection", () => {
  it("lists every connected system with its health", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);

    renderWithQuery(<LiveSection />);

    expect(await screen.findByText("ECC Prod")).toBeInTheDocument();
    // Connection health in its own words, never the data's Go / No-go verdict.
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(screen.queryByText("Go")).toBeNull();
    expect(screen.getByText("Healthy").closest("[data-status=verdict]")).toBeNull();
    expect(await screen.findByText("Nothing is running")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run extraction" })).toBeInTheDocument();
  });

  it("opens the Extract drawer of the system extracted longest ago (never extracted first), not the Systems list", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([
      system,
      { ...system, id: "sys-2", name: "S4 QA", last_sync_at: null },
      { ...system, id: "sys-3", name: "Old", last_sync_at: null, is_active: false },
    ]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);

    renderWithQuery(<LiveSection />);

    await screen.findByText("S4 QA");
    expect(screen.getByRole("link", { name: "Run extraction" })).toHaveAttribute("href", "/systems/sys-2?extract=1");
  });

  it("offers a viewer no extraction or connect action", async () => {
    allowed = false;
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);

    renderWithQuery(<LiveSection />);

    expect(await screen.findByText("No systems connected")).toBeInTheDocument();
    expect(await screen.findByText("Nothing is running")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Run extraction" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Connect a system" })).toBeNull();
    allowed = true;
  });

  it("offers one Connect a system action that opens the connect dialog", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);

    renderWithQuery(<LiveSection />);

    expect(await screen.findByRole("link", { name: "Connect a system" })).toHaveAttribute("href", "/systems?connect=1");
  });

  it("says an untested system is not tested instead of guessing a verdict", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ ...system, health_status: "unknown" }]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);

    renderWithQuery(<LiveSection />);

    expect(await screen.findByText("Not tested")).toBeInTheDocument();
    expect(screen.queryByText("Go")).toBeNull();
  });

  it("leads each system with its health reason, last success, last error and next schedule", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([
      { ...system, health_status: "unreachable", health_message: "Connection refused by sap.example:3300", last_health_check: "2026-10-26T08:00:00Z" },
    ]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);
    vi.spyOn(systemsApi, "getSyncProfiles").mockResolvedValue([
      { id: "p1", system_id: "sys-1", domain: "vendors", tables: [], schedule_cron: "0 2 * * *", active: true, last_run_at: null, next_run_at: "2026-10-27T02:00:00Z", extraction_mode: "full" },
    ]);
    renderWithQuery(<LiveSection />);
    // The reason in plain words, the raw text in its tooltip.
    expect(await screen.findByText("Meridian could not reach the SAP system")).toHaveAttribute("title", "Connection refused by sap.example:3300");
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
    expect(screen.queryByText("No-go")).toBeNull();
    for (const h of ["Last success", "Last error", "Next scheduled"]) expect(screen.getByRole("columnheader", { name: new RegExp(`^${h}`) })).toBeInTheDocument();
    expect(await screen.findByText(/27 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All jobs" })).toHaveAttribute("href", "/admin/jobs");
  });

  it("reads a stored reason code as a sentence, keeping the raw code in the tooltip", async () => {
    const raw = "pyrfc_not_installed: build the API image with INSTALL_PYRFC=true";
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([
      { ...system, health_status: "unreachable", health_message: raw, last_health_check: "2026-10-26T08:00:00Z" },
    ]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);
    renderWithQuery(<LiveSection />);
    expect(await screen.findByText("SAP RFC library not installed on the server")).toHaveAttribute("title", raw);
    expect(screen.queryByText(/pyrfc_not_installed/)).toBeNull();
  });

  it("labels job times as Duration and keeps a long job name on one line with its title", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    const label = "Re-analysis | ERP-SIM vendors and every partner function of the company code";
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([{
      id: "j1", kind: "analysis", status: "completed", label, stage: null, stages: [], percent: 100, rows_done: 0, rows_total: 0,
      message: null, tables: [], error: null, result: null, started_at: 1_792_000_000, updated_at: 1_792_000_010, finished_at: 1_792_000_010, system_id: null,
    } as unknown as Job]);
    renderWithQuery(<LiveSection />);
    expect(await screen.findByRole("columnheader", { name: /^Duration/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^Progress/ })).toBeNull();
    const name = screen.getByText(label.replace(" | ", " of "));
    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute("title", label);
  });

  it("takes the last error from a failed extraction when it is newer than the health check", () => {
    const failed: Job = { id: "dl-1", kind: "extraction", status: "failed", label: "Vendors", stage: null, stages: [], percent: 20, rows_done: 0, rows_total: 0,
      message: "Failed", tables: [], error: "RFC_LOGON_FAILURE: Name or password is incorrect", result: null,
      started_at: 1_792_000_000, updated_at: 1_792_000_050, finished_at: 1_792_000_060, system_id: "sys-1" };
    const ok: Job = { ...failed, id: "dl-0", status: "completed", error: null, finished_at: 1_791_000_000 };
    const [row] = systemRows([{ ...system, last_sync_status: "failed" }], [failed, ok], new Map([["sys-1", null]]));
    expect(row.lastError?.reason).toBe("SAP refused the sign-in");
    expect(row.lastSuccess).toBe(new Date(1_791_000_000 * 1000).toISOString());
    expect(row.next).toBeNull();
  });
});
