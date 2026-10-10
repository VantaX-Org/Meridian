/**
 * T11: frontend API wrappers for the T9/T10 branded-xlsx export endpoints.
 * Each wrapper is a thin call into downloadBlob; these tests assert the
 * URL and params it is called with, not the download mechanics (download.ts
 * owns window.URL/DOM handling and is mocked out here).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../download", () => ({ downloadBlob: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../client", () => ({ default: { get: vi.fn() } }));

import { downloadBlob } from "../download";
import { exportFindingRecords, exportFindings } from "../findings";
import { exportObject, exportObjects } from "../v1/objects";
import { exportRuleHistory, exportRules } from "../rules";
import { exportVersionProfile } from "../field-profile";
import { exportRunSteps, exportRuns } from "../v1/runs";
import { exportAuditEntries } from "../audit";

const mockedDownloadBlob = vi.mocked(downloadBlob);

describe("export wrappers", () => {
  beforeEach(() => {
    mockedDownloadBlob.mockReset().mockResolvedValue(undefined);
  });

  it("exportFindings hits /api/v1/findings/export with format and filters", async () => {
    await exportFindings("xlsx", { version_id: "v1", severity: "critical" });
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/findings/export",
      { format: "xlsx", version_id: "v1", severity: "critical" },
      "findings.xlsx",
    );
  });

  it("exportFindingRecords hits the per-check records/export route", async () => {
    await exportFindingRecords("v1", "BP-001", "csv");
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/versions/v1/findings/BP-001/records/export",
      { format: "csv" },
      "finding_records.csv",
    );
  });

  it("exportObjects hits /api/v1/objects/export with run and format", async () => {
    await exportObjects("v1");
    expect(mockedDownloadBlob).toHaveBeenCalledWith("/api/v1/objects/export", { run: "v1", format: "xlsx" }, "objects.xlsx");
  });

  it("exportObject hits /api/v1/objects/{module}/export", async () => {
    await exportObject("material_master", "v1", "csv");
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/objects/material_master/export",
      { run: "v1", format: "csv" },
      "material_master.csv",
    );
  });

  it("exportRules hits /api/v1/rules/export with filters", async () => {
    await exportRules("xlsx", { module: "material_master", enabled: true });
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/rules/export",
      { format: "xlsx", module: "material_master", enabled: true },
      "rules.xlsx",
    );
  });

  it("exportRuleHistory hits /api/v1/rules/{id}/history/export", async () => {
    await exportRuleHistory("BP-001", "xlsx", 100);
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/rules/BP-001/history/export",
      { format: "xlsx", limit: 100 },
      "rule_history.xlsx",
    );
  });

  it("exportVersionProfile hits the system/version profile/export route", async () => {
    await exportVersionProfile("sys1", "v1", "xlsx", "material_master");
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/systems/sys1/versions/v1/profile/export",
      { format: "xlsx", object: "material_master" },
      "profile.xlsx",
    );
  });

  it("exportRuns hits /api/v1/runs/export with filters", async () => {
    await exportRuns("xlsx", { limit: 50 });
    expect(mockedDownloadBlob).toHaveBeenCalledWith("/api/v1/runs/export", { format: "xlsx", limit: 50 }, "runs.xlsx");
  });

  it("exportRunSteps hits /api/v1/runs/{id}/steps/export", async () => {
    await exportRunSteps("v1", "csv");
    expect(mockedDownloadBlob).toHaveBeenCalledWith("/api/v1/runs/v1/steps/export", { format: "csv" }, "run_steps.csv");
  });

  it("exportAuditEntries hits /api/v1/audit/export with filters", async () => {
    await exportAuditEntries("xlsx", { action: "login" });
    expect(mockedDownloadBlob).toHaveBeenCalledWith(
      "/api/v1/audit/export",
      { format: "xlsx", action: "login" },
      "audit_log.xlsx",
    );
  });
});
