// frontend/app/(app)/runs/__tests__/page.test.tsx
import Link from "next/link";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { Button } from "@/design";
import * as connectivityApi from "@/lib/api/connectivity";
import * as retentionApi from "@/lib/api/retention";
import * as uploadApi from "@/lib/api/upload";
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
// The Run analysis drawer's object picker reads a system's objects; the page test only needs it to appear.
vi.mock("@/app/(app)/systems/[systemId]/scope-picker", () => ({ ScopePicker: () => <div data-testid="scope-picker" /> }));
// useDayOne() shares the systems/versions query keys with this page's own queries;
// mocking it outright avoids a real-vs-mocked getSystems collision on queryKeys.systems().
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
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

  it("opens Run analysis as the system-picker drawer, under the Operate view tabs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    expect(await screen.findByRole("navigation", { name: "Operate views" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Runs" })).toHaveAttribute("aria-current", "page");
    // One run: the score tile names its system, its run and day, and what the number is a mean of.
    expect(await screen.findByText("Latest DQS, ECC Prod")).toBeInTheDocument();
    expect(await screen.findByText("Oct 8 upload, 8 Oct 2026, mean of 1 object")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    expect(await screen.findByRole("dialog", { name: "Run analysis" })).toBeInTheDocument();
    expect(await screen.findByTestId("scope-picker")).toBeInTheDocument();
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
    expect(screen.getByText("Latest DQS, ECC Prod")).toBeInTheDocument();
    expect(screen.getByText("Oct 8 upload, 8 Oct 2026, vs previous run")).toBeInTheDocument();
  });

  it("names uploads, never a made-up system, when the latest run has no system", async () => {
    const meta = { modules: ["material_master"], file_name: "upload.csv", row_count: 10 };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ ...newer, metadata: meta }, { ...older, metadata: meta }] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    expect(await screen.findByText("Score per run, uploads")).toBeInTheDocument();
    expect(screen.getByText("Latest DQS, uploads")).toBeInTheDocument();
    expect(screen.queryByText(/latest system/)).toBeNull();
  });

  it("groups the ledger by day, newest first: the day is printed on the first run of each day only, and each row ends in Open", async () => {
    const sameDay = version({ id: "v2b", label: "Oct 8 evening", run_at: "2026-10-08T18:00:00Z", dqs_summary: { material_master: dqs(73.1) } });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [older, newer, sameDay] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    const body = screen.getAllByRole("row").slice(1);
    expect(body.map((r) => r.textContent)).toEqual([
      expect.stringContaining("8 Oct 2026"), expect.not.stringContaining("8 Oct 2026"), expect.stringContaining("1 Oct 2026"),
    ]);
    expect(body[0]).toHaveTextContent("Oct 8 evening");
    expect(screen.getByRole("link", { name: "Open Oct 8 upload" })).toHaveAttribute("href", "/runs/v2");
  });

  it("compares the newer run against the older one when two rows are selected", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select Oct 1 upload"));
    expect(screen.getByText("Select two runs")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select Oct 8 upload"));
    const bulkBar = screen.getByText("2 selected").parentElement as HTMLElement;
    fireEvent.click(within(bulkBar).getByRole("button", { name: "Compare" }));
    expect(push).toHaveBeenCalledWith("/runs/v2/vs/v1");
  });

  it("compares on c, but not while a dialog, menu or control has the keyboard", async () => {
    push.mockClear();
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select Oct 1 upload"));
    fireEvent.click(screen.getByLabelText("Select Oct 8 upload"));
    for (const role of ["dialog", "alertdialog", "listbox", "option", "menu", "menuitem", "combobox"]) {
      const owner = document.createElement("div");
      owner.setAttribute("role", role);
      document.body.appendChild(owner);
      fireEvent.keyDown(owner, { key: "c" });
      owner.remove();
    }
    fireEvent.keyDown(screen.getByRole("button", { name: "Compare" }), { key: "c" });
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "c" });
    expect(push).toHaveBeenCalledWith("/runs/v2/vs/v1");
  });

  it("shows live progress on a run that is still being analysed", async () => {
    const running: Version = { ...newer, id: "v3", label: "Tonight", status: "running" };
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [running, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    vi.spyOn(uploadApi, "getAnalysisStatus").mockResolvedValue({
      version_id: "v3", status: "processing", error: null, db_status: "running",
      progress: { current_step: "Running checks", step_number: 2, total_steps: 4, rows_processed: 500, total_rows: 1000, percent_complete: 42 },
      result: null,
    } as unknown as uploadApi.AnalysisStatusResponse);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("42% Running checks")).toBeInTheDocument());
    expect(screen.getByRole("progressbar", { name: "Running checks progress" })).toHaveAttribute("aria-valuenow", "42");
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

describe("RunsPage archive", () => {
  it("archives older runs keeping the newest N and refreshes the list", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    const archive = vi.spyOn(versionsApi, "archiveVersions").mockResolvedValue({ archived: 1 });
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Archive older runs" }));
    const keep = await screen.findByLabelText("Keep the newest");
    fireEvent.change(keep, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(3));
  });

  it("?archived=1 asks for archived runs, marks them, and offers restore", async () => {
    searchParams.set("archived", "1");
    const archived = version({ id: "v0", label: "Old upload", run_at: "2026-09-01T00:00:00Z", metadata: { system_id: "sys-1", archived: true } });
    const get = vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, archived] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    const restore = vi.spyOn(versionsApi, "restoreVersions").mockResolvedValue({ restored: 1 });
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Old upload")).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ include_archived: true }));
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter Including archived" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore archived runs" }));
    await waitFor(() => expect(restore).toHaveBeenCalled());
    searchParams.delete("archived");
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

describe("RunsPage delete permanently", () => {
  const archived = version({ id: "v0", label: "Old upload", run_at: "2026-09-01T00:00:00Z", metadata: { system_id: "sys-1", archived: true } });

  it("offers the action on archived runs only and purges after the label is typed", async () => {
    searchParams.set("archived", "1");
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, archived] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    const del = vi.spyOn(retentionApi, "deleteVersion").mockResolvedValue({
      version_id: "v0", rows_by_table: { findings: 3, analysis_versions: 1 }, bytes_freed: 10, blocked_reason: null,
      storage_errors: [], purge_log_id: "l1",
    });
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Old upload")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /Delete .* permanently/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete Old upload permanently" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    expect(del).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Type to confirm"), { target: { value: "Old upload" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(del).toHaveBeenCalledWith("v0", "Old upload"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    searchParams.delete("archived");
  });

  it("keeps the run when the dialog is dismissed", async () => {
    searchParams.set("archived", "1");
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, archived] });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([system]);
    const del = vi.spyOn(retentionApi, "deleteVersion").mockResolvedValue({
      version_id: "v0", rows_by_table: {}, bytes_freed: 0, blocked_reason: null, storage_errors: [], purge_log_id: null,
    });
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Old upload")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Delete Old upload permanently" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(del).not.toHaveBeenCalled();
    searchParams.delete("archived");
  });
});
