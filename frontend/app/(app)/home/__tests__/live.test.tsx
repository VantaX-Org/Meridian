// frontend/app/(app)/home/__tests__/live.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as jobsApi from "@/lib/api/jobs";
import type { SAPSystemExtended } from "@/types/api";
import { LiveSection } from "../_live";

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
  last_analysis_at: null,
};

describe("LiveSection", () => {
  it("lists every connected system with its health", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    vi.spyOn(jobsApi, "getJobs").mockResolvedValue([]);

    renderWithQuery(<LiveSection />);

    expect(await screen.findByText("ECC Prod")).toBeInTheDocument();
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
    expect(await screen.findByText("Nothing is running.")).toBeInTheDocument();
  });
});
