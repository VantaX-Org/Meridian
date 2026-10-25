import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as retentionApi from "@/lib/api/retention";
import * as connectivityApi from "@/lib/api/connectivity";
import type { PurgeLogEntry, RetentionResponse } from "@/lib/api/retention";
import { RetentionPanel, formatBytes, rangeError } from "../retention-panel";

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
  it("confirms a shorter policy while purges are enforced, naming the runs and systems that go", async () => {
    vi.spyOn(retentionApi, "getRetention").mockResolvedValue({
      ...RESPONSE, enforcement: { flag_enabled: true, dry_run_until: "2026-10-01T00:00:00Z", enforced: true },
    });
    vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([]);
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "sys-1", name: "ECC Prod" }] as never);
    // the saved policy selects nothing; the draft being saved selects one run
    const saved = vi.spyOn(retentionApi, "getRetentionPreview").mockResolvedValue([]);
    const draft = vi.spyOn(retentionApi, "previewRetentionDraft").mockResolvedValue([
      { version_id: "v-1", label: null, run_at: "2026-03-01T00:00:00Z", system_id: "sys-1", blocked_reason: null, rows_by_table: {}, bytes_freed: 0 },
    ]);
    const update = vi.spyOn(retentionApi, "updateRetention").mockResolvedValue(RESPONSE);
    renderWithQuery(<RetentionPanel />);
    await waitFor(() => expect(screen.getByLabelText("Keep runs for (days)")).toHaveValue(180));
    fireEvent.change(screen.getByLabelText("Keep runs for (days)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText(/1 run from ECC Prod will be purged nightly/)).toBeInTheDocument();
    expect(draft.mock.calls[0][0]).toEqual({ ...RESPONSE.policy, versions_days: 30 });
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save policy" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
  });

  it("shows the policy, the dry-run line and the purge log", async () => {
    vi.spyOn(retentionApi, "getRetention").mockResolvedValue(RESPONSE);
    vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([LOG]);
    renderWithQuery(<RetentionPanel />);
    await waitFor(() => expect(screen.getByLabelText("Keep runs for (days)")).toHaveValue(180));
    expect(screen.getByLabelText("Keep reports for (days)")).toHaveValue(null);
    expect(screen.getByRole("switch", { name: "Keep the baseline run" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Dry run until .*2026\. Ask your platform operator to turn on enforced purges\./)).toBeInTheDocument();
    expect(screen.getByText("Dry run restarts when the policy changes")).toBeInTheDocument();
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("Dry run")).toBeInTheDocument();
    expect(within(grid).getByText("finding_records 300, findings 12, analysis_versions 1")).toBeInTheDocument();
    expect(within(grid).getByText("2 KB")).toBeInTheDocument();
    expect(within(grid).getByText("Scheduler")).toBeInTheDocument();
  });

  it("shows each field's range error and keeps Save disabled while any field is invalid", async () => {
    vi.spyOn(retentionApi, "getRetention").mockResolvedValue(RESPONSE);
    vi.spyOn(retentionApi, "getPurgeLog").mockResolvedValue([]);
    const update = vi.spyOn(retentionApi, "updateRetention");
    renderWithQuery(<RetentionPanel />);
    await waitFor(() => expect(screen.getByLabelText("Keep runs for (days)")).toHaveValue(180));
    const save = screen.getByRole("button", { name: "Save policy" });
    const runs = screen.getByLabelText("Keep runs for (days)");
    // 0 is out of range, not "for ever"
    fireEvent.change(runs, { target: { value: "0" } });
    expect(screen.getByText("Between 1 and 3650")).toBeInTheDocument();
    expect(runs).toHaveAttribute("aria-invalid", "true");
    expect(save).toBeDisabled();
    fireEvent.change(runs, { target: { value: "4000" } });
    expect(screen.getByText("Between 1 and 3650")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(runs, { target: { value: "" } });
    expect(screen.queryByText("Between 1 and 3650")).not.toBeInTheDocument();
    expect(save).toBeEnabled(); // empty means keep for ever, a real change from 180
    // the latest-per-system count is required and capped at 100, never clamped
    const latest = screen.getByLabelText("Keep latest per system");
    fireEvent.change(latest, { target: { value: "250" } });
    expect(screen.getByText("Between 0 and 100")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(latest, { target: { value: "" } });
    expect(screen.getByText("Between 0 and 100")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(latest, { target: { value: "3" } });
    expect(screen.queryByText("Between 0 and 100")).not.toBeInTheDocument();
    expect(save).toBeEnabled();
    expect(update).not.toHaveBeenCalled();
  });

  it("validates ranges without normalising", () => {
    expect(rangeError("", 1, 3650)).toBeUndefined();
    expect(rangeError("0", 1, 3650)).toBe("Between 1 and 3650");
    expect(rangeError("1.5", 1, 3650)).toBe("Between 1 and 3650");
    expect(rangeError("3650", 1, 3650)).toBeUndefined();
    expect(rangeError("", 0, 100, true)).toBe("Between 0 and 100");
    expect(rangeError("0", 0, 100, true)).toBeUndefined();
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
    expect(screen.getByText("Between 30 and 3650")).toBeInTheDocument();
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
