import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "../client";
import * as download from "../download";
import {
  downloadRealignment,
  getConfigCompare,
  getFindingContext,
  proposeConfigMatches,
  SCOPE_LABEL,
} from "../config-pairing";

afterEach(() => vi.restoreAllMocks());

describe("config-pairing API", () => {
  it("passes the selected object to compare", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { source_load_id: null, target: { system_id: null, label: "baseline target", baseline: true }, objects: [], rows: [] } });
    await getConfigCompare("sys1", "T077K");
    expect(get).toHaveBeenCalledWith("/api/v1/config-pairing/compare/sys1", { params: { object: "T077K" } });
  });

  it("posts a proposal run", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { proposed: 2, skipped: 0, target: "S4D" } });
    expect(await proposeConfigMatches("sys1")).toEqual({ proposed: 2, skipped: 0, target: "S4D" });
    expect(post).toHaveBeenCalledWith("/api/v1/config-pairing/propose/sys1");
  });

  it("sends finding-context fields as repeated params", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: null });
    await getFindingContext({ ruleId: "AP-001", module: "accounts_payable", versionId: "v1", fields: ["LFA1.KTOKK"] });
    expect(get).toHaveBeenCalledWith("/api/v1/config-pairing/finding-context", {
      params: { rule_id: "AP-001", module: "accounts_payable", version_id: "v1", fields: ["LFA1.KTOKK"] },
      paramsSerializer: { indexes: null },
    });
  });

  it("downloads the realignment report and labels scopes", async () => {
    const dl = vi.spyOn(download, "downloadBlob").mockResolvedValue();
    await downloadRealignment("run1", "pdf");
    expect(dl).toHaveBeenCalledWith("/api/v1/migration/runs/run1/realignment.pdf", {}, "config_realignment_run1.pdf");
    expect(SCOPE_LABEL).toEqual({ global: "Global", source: "This source", pair: "This pair" });
  });
});
