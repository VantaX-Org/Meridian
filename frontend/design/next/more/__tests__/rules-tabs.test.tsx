import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { replace, setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { Rules } from "../Rules";
import { RuleDryRun } from "../RuleDryRun";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/design/v2/admin/Admin", () => ({ AdminCanvas: () => <div data-testid="packs" /> }));
vi.mock("@/design/v2/screens/RulePromotion", () => ({ RulePromotion: () => <div data-testid="promotion" /> }));
vi.mock("@/design/v2/screens/AnomalyRules", () => ({ AnomalyRules: () => <div data-testid="anomaly" /> }));

const S = vi.hoisted(() => ({ can: (): boolean => true, run: vi.fn() }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: S.can }) }));
vi.mock("@/lib/v2/sys-queries", () => ({
  useRuleList: () => ({ data: { rules: [] }, isLoading: false, error: null, refetch: () => Promise.resolve() }),
  useAllDrafts: () => ({ data: [], isLoading: false, error: null, refetch: () => Promise.resolve() }),
}));
vi.mock("@/lib/api/v2/rule-impact", () => ({ runImpactDryRun: S.run }));

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

beforeEach(() => {
  S.can = () => true;
  S.run.mockReset();
  replace.mockClear();
});

describe("Rules tabs from the address", () => {
  it.each([
    ["promotion", "promotion"],
    ["anomaly", "anomaly"],
    ["dryrun", "rule-dry-run"],
  ])("?tab=%s opens that segment", (tab, id) => {
    setUrl(`/more/rules?tab=${tab}`);
    wrap(<Rules />);
    expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it("an unknown tab falls back to Active, and choosing a segment writes it to the address", () => {
    setUrl("/more/rules?tab=nope");
    wrap(<Rules />);
    expect(screen.getByText("No rules yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Dry run" }));
    expect(replace).toHaveBeenCalledWith("/more/rules?tab=dryrun", { scroll: false });
  });
});

describe("RuleDryRun in the new kit", () => {
  it("is gated on the manage rules permission", () => {
    S.can = () => false;
    setUrl("/more/rules?tab=dryrun&module=accounts_payable&rule=AP-1");
    wrap(<RuleDryRun />);
    expect(screen.getByText("Running a dry run needs the manage rules permission.")).toBeInTheDocument();
    expect(screen.getByTestId("dry-run-go")).toHaveAttribute("aria-disabled", "true");
    fireEvent.submit(screen.getByTestId("dry-run-form"));
    expect(S.run).not.toHaveBeenCalled();
  });

  it("rejects changes that are not a JSON object", () => {
    setUrl("/more/rules?tab=dryrun&module=accounts_payable");
    wrap(<RuleDryRun />);
    fireEvent.change(screen.getByTestId("dry-run-changes"), { target: { value: "[1]" } });
    fireEvent.click(screen.getByTestId("dry-run-go"));
    expect(screen.getByText(/must be a JSON object of rule fields/)).toBeInTheDocument();
    expect(S.run).not.toHaveBeenCalled();
  });

  it("runs from the address, then shows the split, score change, edit delta, shapes and the rule link", async () => {
    S.run.mockResolvedValue({
      module: "accounts_payable", run_id: "r1", rule_id: "AP-1", mode: "edit",
      rule: { field: "LIFNR", field_text: "Vendor", message: "Vendor must be set", check_class: null, severity: null, dimension: null },
      evaluated: true, reason: null, row_cap: { cap: 50000, sampled: true, tables_cut: {}, note: "" },
      records_evaluated: 1000, records_failing: 40, failure_rate: 4,
      failing_shapes: [{ shape: "999", count: 30 }, { shape: "AAA", count: 10 }],
      dqs: { before: 90, after: 88.5, delta: -1.5, breaches_before: 0, breaches_after: 1 },
      delta: { current_failing: 20, newly_failing: 25, newly_passing: 5, unchanged_failing: 15, basis: "" },
    });
    setUrl("/more/rules?tab=dryrun&module=accounts_payable&rule=AP-1");
    wrap(<RuleDryRun />);
    fireEvent.click(screen.getByTestId("dry-run-go"));
    await waitFor(() => expect(screen.getByTestId("dry-run-result")).toBeInTheDocument());
    expect(S.run.mock.calls[0][0]).toEqual({ module: "accounts_payable", rule_id: "AP-1", rule: undefined, row_cap: 50000 });
    expect(screen.getByTestId("dry-run-delta-score")).toHaveTextContent("-1.5");
    expect(screen.getByTestId("dry-run-edit-line")).toHaveTextContent("25 newly failing, 5 newly passing.");
    expect(screen.getByRole("link", { name: "Open the rule" })).toHaveAttribute("href", "/more/rules/AP-1");
    expect(screen.getByTestId("dry-run-cap-note")).toHaveTextContent(/scaled to the full table/);
    expect(screen.getByText("999")).toBeInTheDocument();
  });
});
