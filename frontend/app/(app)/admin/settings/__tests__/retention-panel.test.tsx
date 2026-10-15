import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as retentionApi from "@/lib/api/retention";
import type { PurgeLogEntry, RetentionResponse } from "@/lib/api/retention";
import { RetentionPanel, formatBytes } from "../retention-panel";

const RESPONSE: RetentionResponse = {
  policy: { versions_days: 180, reports_days: null, audit_days: 365, keep_baseline: true, keep_latest_per_system: 1 },
  enforcement: { flag_enabled: false, dry_run_until: "2026-10-22T02:30:00Z", enforced: false },
};
const LOG: PurgeLogEntry = {
  id: "l1", kind: "version", target_id: "0f9c1234-aaaa-bbbb-cccc-000000000000", dry_run: true,
  rows_by_table: { findings: 12, finding_records: 300, analysis_versions: 1 }, bytes_freed: 2048,
  blocked_reason: null, actor_email: null, created_at: "2026-10-14T02:30:00Z",
};

describe("RetentionPanel", () => {
  it("shows the policy, the dry-run line and the purge log", async () => {
    vi.spyOn(retentionApi, "getRetention").mockResolvedValue(RESPONSE);
    vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([LOG]);
    renderWithQuery(<RetentionPanel />);
    await waitFor(() => expect(screen.getByLabelText("Keep runs for (days)")).toHaveValue(180));
    expect(screen.getByLabelText("Keep reports for (days)")).toHaveValue(null);
    expect(screen.getByRole("switch", { name: "Keep the baseline run" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Dry run until .*2026; set MERIDIAN_PURGE_ENABLED to enforce\./)).toBeInTheDocument();
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("Dry run")).toBeInTheDocument();
    expect(within(grid).getByText("finding_records 300, findings 12, analysis_versions 1")).toBeInTheDocument();
    expect(within(grid).getByText("2 KB")).toBeInTheDocument();
    expect(within(grid).getByText("Scheduler")).toBeInTheDocument();
  });

  it("saves an edited policy and refuses audit retention under 30 days", async () => {
    vi.spyOn(retentionApi, "getRetention").mockResolvedValue(RESPONSE);
    vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([]);
    const update = vi.spyOn(retentionApi, "updateRetention").mockResolvedValue({
      ...RESPONSE, policy: { ...RESPONSE.policy, versions_days: 90, keep_baseline: false, keep_latest_per_system: 2 },
    });
    renderWithQuery(<RetentionPanel />);
    await waitFor(() => expect(screen.getByLabelText("Keep runs for (days)")).toHaveValue(180));
    const save = screen.getByRole("button", { name: "Save policy" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Keep audit rows for (days)"), { target: { value: "7" } });
    expect(screen.getByText("At least 30 days")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Keep audit rows for (days)"), { target: { value: "365" } });
    fireEvent.change(screen.getByLabelText("Keep runs for (days)"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Keep latest per system"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("switch", { name: "Keep the baseline run" }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      versions_days: 90, reports_days: null, audit_days: 365, keep_baseline: false, keep_latest_per_system: 2,
    }));
  });

  it("previews what would be purged, with the blocked reasons", async () => {
    vi.spyOn(retentionApi, "getRetention").mockResolvedValue({
      ...RESPONSE, enforcement: { flag_enabled: true, dry_run_until: "2026-10-01T00:00:00Z", enforced: true },
    });
    vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([]);
    const preview = vi.spyOn(retentionApi, "getRetentionPreview").mockResolvedValue([
      { version_id: "v-1", label: "March run", run_at: "2026-03-01T00:00:00Z", system_id: "upload",
        blocked_reason: null, rows_by_table: { findings: 4, analysis_versions: 1 }, bytes_freed: 0 },
      { version_id: "v-2", label: null, run_at: "2026-02-01T00:00:00Z", system_id: "sys-1",
        blocked_reason: "2 write-back requests pending or approved", rows_by_table: {}, bytes_freed: 0 },
    ]);
    renderWithQuery(<RetentionPanel />);
    await waitFor(() => expect(screen.getByText(/Purges are enforced/)).toBeInTheDocument());
    expect(preview).not.toHaveBeenCalled();
    expect(screen.getByText("No purge yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview what would be purged" }));
    await waitFor(() => expect(screen.getByText("March run")).toBeInTheDocument());
    expect(screen.getByText("Would be purged")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("2 write-back requests pending or approved")).toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
  });

  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});
