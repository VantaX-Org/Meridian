// frontend/app/(app)/runs/__tests__/page.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import * as versionsApi from "@/lib/api/versions";
import type { DimensionScores, SAPSystem, Version } from "@/types/api";
import RunsPage from "../page";

const push = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/runs",
  useSearchParams: () => searchParams,
}));

const zeroDimensions: DimensionScores = {
  completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0,
};

const dqs = (composite_score: number) => ({
  composite_score, dimension_scores: zeroDimensions, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0,
  total_checks: 0, passing_checks: 0, capped: false, cap_reason: null,
});

function version(over: Partial<Version> & { id: string }): Version {
  return {
    label: null, status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "upload.csv", row_count: 10, system_id: "sys-1" },
    ...over,
  };
}

const system: SAPSystem = {
  id: "sys-1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", last_sync_at: null, last_sync_status: null,
};

const newer = version({ id: "v2", label: "Oct 8 upload", dqs_summary: { material_master: dqs(74.8) } });
const older = version({ id: "v1", label: "Oct 1 upload", run_at: "2026-10-01T00:00:00Z", dqs_summary: { material_master: dqs(71.2) } });

describe("RunsPage", () => {
  it("shows the DQS column and a sparkline per system", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    expect(screen.getByText("74.8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ECC Prod/ })).toBeInTheDocument();
  });

  it("compares the newer run against the older one when two rows are selected", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select row v1"));
    expect(screen.getByText("Select exactly two runs to compare")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select row v2"));
    const bulkBar = screen.getByText("2 selected").parentElement as HTMLElement;
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Compare" }));
    expect(push).toHaveBeenCalledWith("/runs/v2/vs/v1");
  });

  it("shows the empty state when there are no runs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/no runs/i)).toBeInTheDocument());
  });

  it("links the per-row Compare button to the predecessor run, and disables it when there is none", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());

    const rowNewer = screen.getByText("Oct 8 upload").closest("tr") as HTMLElement;
    const rowOlder = screen.getByText("Oct 1 upload").closest("tr") as HTMLElement;

    const compareNewer = within(rowNewer).getByRole("link", { name: "Compare" });
    expect(compareNewer).toHaveAttribute("href", "/runs/v2/vs/v1");

    const compareOlder = within(rowOlder).getByRole("button", { name: "Compare" });
    expect(compareOlder).toHaveAttribute("aria-disabled", "true");
    expect(within(rowOlder).queryByRole("link", { name: "Compare" })).not.toBeInTheDocument();
  });

  it("shows an error state with Try again when runs fail to load, and retries on click", async () => {
    const getVersions = vi.spyOn(versionsApi, "getVersions").mockRejectedValueOnce(new Error("network down"));
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());

    getVersions.mockResolvedValueOnce({ versions: [newer, older] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
  });

  it("filters the table to a system when its sparkline is clicked", async () => {
    const getVersions = vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /ECC Prod/ }));

    await waitFor(() => expect(screen.getByText("Filtered")).toBeInTheDocument());
    expect(getVersions).toHaveBeenCalledWith({ system_id: "sys-1", limit: 100 });
  });
});
