import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import type { RuleVersion } from "@/lib/api/rules";
import { RuleVersionDiff } from "../rule-version-diff";

const V = (version: number, state: string): RuleVersion => ({
  rule_id: "AP001", version, body: {}, state, note: null, created_by: "ana", approved_by: null, approved_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
});
const DIFF = "--- v1\n+++ v2\n@@ -1,2 +1,2 @@\n field: LFA1.STCD1\n-severity: high\n+severity: critical\n";

beforeEach(() => vi.restoreAllMocks());

describe("RuleVersionDiff", () => {
  it("reads the newest version against the one before it as a table of changed lines", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(2, "active"), V(1, "retired")] });
    const diff = vi.spyOn(api, "getRuleVersionDiff").mockResolvedValue({ rule_id: "AP001", from: "v1", to: "v2", diff: DIFF });
    renderWithQuery(<RuleVersionDiff ruleId="AP001" />);
    const table = await screen.findByRole("table", { name: "Changed lines" });
    expect(diff).toHaveBeenCalledWith("AP001", 2);
    expect(table).toHaveTextContent("Removed");
    expect(table).toHaveTextContent("severity: high");
    expect(table).toHaveTextContent("Added");
    expect(table).toHaveTextContent("severity: critical");
    expect(screen.getByText("v2 against v1")).toBeInTheDocument();
  });

  it("names the shipped rule when the first version is the one read", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(1, "draft")] });
    vi.spyOn(api, "getRuleVersionDiff").mockResolvedValue({ rule_id: "AP001", from: "shipped@3fa9c2", to: "v1", diff: DIFF });
    renderWithQuery(<RuleVersionDiff ruleId="AP001" />);
    expect(await screen.findByText("v1 against the shipped rule")).toBeInTheDocument();
  });

  it("reads another version when it is picked", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(2, "active"), V(1, "retired")] });
    const diff = vi.spyOn(api, "getRuleVersionDiff").mockResolvedValue({ rule_id: "AP001", from: "shipped@abc", to: "v1", diff: DIFF });
    renderWithQuery(<RuleVersionDiff ruleId="AP001" />);
    await userEvent.click(await screen.findByRole("combobox", { name: "Version to read" }));
    await userEvent.click(await screen.findByRole("option", { name: "v1, retired" }));
    await waitFor(() => expect(diff).toHaveBeenCalledWith("AP001", 1));
  });

  it("says when two versions read the same", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(2, "active")] });
    vi.spyOn(api, "getRuleVersionDiff").mockResolvedValue({ rule_id: "AP001", from: "v1", to: "v2", diff: "" });
    renderWithQuery(<RuleVersionDiff ruleId="AP001" />);
    expect(await screen.findByText("Nothing differs")).toBeInTheDocument();
  });

  it("has nothing to compare for a rule that runs as shipped", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: { source: "ap.yaml", hash: "abc", app_version: "1", rule: {} }, versions: [] });
    const diff = vi.spyOn(api, "getRuleVersionDiff");
    renderWithQuery(<RuleVersionDiff ruleId="AP001" />);
    expect(await screen.findByText("No versions to compare")).toBeInTheDocument();
    expect(diff).not.toHaveBeenCalled();
  });
});
