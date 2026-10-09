import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as systemObjectsApi from "@/lib/api/system-objects";
import * as configLoadApi from "@/lib/api/config-load";
import type { SAPSystemExtended } from "@/types/api";
import SystemsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/systems",
  useSearchParams: () => new URLSearchParams(),
}));

const SYSTEM: SAPSystemExtended = {
  id: "s1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  health_status: "healthy", health_message: null, last_health_check: null, config_last_synced_at: null,
  config_sync_status: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  last_sync_at: null, last_sync_status: null, discovery_status: null, discovered_at: null, sap_release: null,
} as SAPSystemExtended;

describe("systems list page", () => {
  it("renders systems once loaded", async () => {
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([SYSTEM]);
    vi.spyOn(systemObjectsApi, "getSystemVersions").mockResolvedValue({ versions: [], download: null });
    vi.spyOn(configLoadApi, "getConfigLandscape").mockResolvedValue({ systems: [], counts: {}, loaded: 0, total: 1 });
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });

  it("shows a retryable error when systems fail to load", async () => {
    const spy = vi.spyOn(connectivityApi, "getSystems").mockRejectedValue(new Error("network down"));
    renderWithQuery(<SystemsPage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue([SYSTEM]);
    retry.click();
    await waitFor(() => expect(screen.getByText("ECC Prod")).toBeInTheDocument());
  });
});
