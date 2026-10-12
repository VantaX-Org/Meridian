// frontend/app/(app)/runs/__tests__/page.test.tsx
import Link from "next/link";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { Button } from "@/design";
import * as connectivityApi from "@/lib/api/connectivity";
import * as versionsApi from "@/lib/api/versions";
import type { DimensionScores, SAPSystemExtended, Version } from "@/types/api";
import RunsPage from "../page";

const push = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/runs",
  useSearchParams: () => searchParams,
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
// useDayOne() shares the systems/versions query keys with this page's own queries;
// mocking it outright avoids a real-vs-mocked getSystems collision on queryKeys.systems().
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null }),
  DayOneAction: ({ step, fallbackHref, fallbackLabel }: { step: { href: string | null; label: string; actionable: boolean } | null; fallbackHref: string; fallbackLabel: string }) =>
    step && (!step.actionable || !step.href) ? (
      <span>{step.label}</span>
    ) : (
      <Button render={<Link href={step?.href ?? fallbackHref}>{step?.label ?? fallbackLabel}</Link>} />
    ),
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

const system: SAPSystemExtended = {
  id: "sys-1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", last_sync_at: null, last_sync_status: null,
  health_status: "healthy", health_message: null, last_health_check: null, config_last_synced_at: null,
  config_sync_status: null, discovery_status: null, discovered_at: null, sap_release: null, last_analysis_at: null,
  role: "source", target_system_id: null,
};

const newer = version({ id: "v2", label: "Oct 8 upload", dqs_summary: { material_master: dqs(74.8) } });
const older = version({ id: "v1", label: "Oct 1 upload", run_at: "2026-10-01T00:00:00Z", dqs_summary: { material_master: dqs(71.2) } });

describe("RunsPage", () => {
  describe("chart slot", () => {
    it("is reserved while loading", () => {
      vi.spyOn(versionsApi, "getVersions").mockReturnValue(new Promise(() => {}));
      vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
      renderWithQuery(<RunsPage />);
      expect(screen.getByTestId("runs-chart-slot")).toBeInTheDocument();
    });

    it("holds a muted placeholder with one run", async () => {
      vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer] });
      vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
      renderWithQuery(<RunsPage />);
      await waitFor(() => expect(screen.getByText("Trend appears after two runs")).toBeInTheDocument());
      expect(within(screen.getByTestId("runs-chart-slot")).getByText("Trend appears after two runs")).toBeInTheDocument();
    });

    it("holds the chart with two runs", async () => {
      vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
      vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
      renderWithQuery(<RunsPage />);
      await waitFor(() => expect(screen.getByText("Score per run, ECC Prod")).toBeInTheDocument());
      expect(within(screen.getByTestId("runs-chart-slot")).getByText("Score per run, ECC Prod")).toBeInTheDocument();
      expect(screen.queryByText("Trend appears after two runs")).toBeNull();
    });
  });

  it("shows the DQS column and a score chart for the latest system", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    const links = screen.getAllByText("74.8").map((el) => el.closest("a"));
    expect(links.length).toBeGreaterThan(1); // stat tile and table cell
    for (const link of links) expect(link).toHaveAttribute("href", "/runs/v2");
    expect(screen.getByText("Score per run, ECC Prod")).toBeInTheDocument();
  });

  it("compares the newer run against the older one when two rows are selected", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select row v1"));
    expect(screen.getByText("Select two runs")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select row v2"));
    const bulkBar = screen.getByText("2 selected").parentElement as HTMLElement;
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Compare" }));
    expect(push).toHaveBeenCalledWith("/runs/v2/vs/v1");
  });

  it("shows the empty state when there are no runs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/no runs/i)).toBeInTheDocument());
  });

  it("has no per-row Compare button; comparing is a bulk action", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Compare" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).not.toBeInTheDocument();
  });

  it("shows an error state with Try again when runs fail to load, and retries on click", async () => {
    const getVersions = vi.spyOn(versionsApi, "getVersions").mockRejectedValueOnce(new Error("network down"));
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());

    getVersions.mockResolvedValueOnce({ versions: [newer, older] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
  });

  it("filters to a system from the URL and shows a removable chip", async () => {
    searchParams.set("system", "sys-1");
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove filter System: ECC Prod" })).toBeInTheDocument();
    searchParams.delete("system");
  });
});

describe("RunsPage status param", () => {
  it.each(["garbage", "constructor"])("ignores ?status=%s: every run, no banner", async (v) => {
    searchParams.set("status", v);
    const failed = version({ id: "v3", label: "Broken run", status: "failed" });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, failed] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    expect(screen.getByText("Broken run")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show all runs" })).not.toBeInTheDocument();
    searchParams.delete("status");
  });

  it("?status=failed shows only failed runs", async () => {
    searchParams.set("status", "failed");
    const failed = version({ id: "v3", label: "Broken run", status: "failed" });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, failed] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Broken run")).toBeInTheDocument());
    expect(screen.queryByText("Oct 8 upload")).not.toBeInTheDocument();
    searchParams.delete("status");
  });
});
