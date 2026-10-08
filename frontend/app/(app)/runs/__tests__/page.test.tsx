// frontend/app/(app)/runs/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as versionsApi from "@/lib/api/versions";
import * as systemsApi from "@/lib/api/systems";
import type { SAPSystem, Version } from "@/types/api";
import RunsPage from "../page";

const version: Version = {
  id: "v1",
  label: "Oct 8 upload",
  status: "complete",
  run_at: "2026-10-08T00:00:00Z",
  dqs_summary: null,
  metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 10, system_id: "sys-1" },
};

const system: SAPSystem = {
  id: "sys-1",
  name: "ECC Prod",
  system_type: "ecc",
  host: null,
  client: null,
  sysnr: null,
  username: null,
  base_url: null,
  company_id: null,
  auth_type: null,
  description: null,
  environment: "PRD",
  is_active: true,
  created_at: "2026-10-08T00:00:00Z",
  updated_at: "2026-10-08T00:00:00Z",
  last_sync_at: null,
  last_sync_status: null,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("RunsPage", () => {
  it("renders one row per run, including its system's name", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [version] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });

  it("shows an empty state with no runs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/no runs/i)).toBeInTheDocument());
  });
});
