// frontend/app/(app)/home/__tests__/live.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as jobsApi from "@/lib/api/jobs";
import type { SAPSystemExtended } from "@/types/api";
import { LiveSection } from "../_live";

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
    // Connection health reads as the verdict vocabulary, and the row opens the system's Health tab.
    expect(await screen.findByText("Go")).toBeInTheDocument();
    expect(screen.getByText("Go").closest("[data-status]")).toHaveAttribute("data-status", "verdict");
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
});
