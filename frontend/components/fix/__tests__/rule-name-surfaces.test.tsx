// One name per check id: every surface that names a rule goes through lib/rule-name.ts `resolveRuleName` (catalogue
// name, then the finding's own message, then generated words). BP002's catalogue says "exactly 10-digit numeric"; its
// finding's stored message says "1-10 uppercase letters or digits". The run tab, Executive summary's Fix first, the
// failing-rules ranking, the object pages, compare and Process all show the catalogue's words.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { DataTable } from "@/design";
import * as rulesApi from "@/lib/api/rules";
import type { RuleRow } from "@/lib/api/insights";
import { useRuleNames } from "@/lib/rule-name";
import type { Finding } from "@/types/api";
import { currentFindingColumns } from "@/app/(app)/insights/_components/currentFindings";
import { ruleColumns } from "@/app/(app)/insights/_components/RuleColumns";
import { RuleCell, RuleName } from "../rule-cell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

afterEach(() => vi.restoreAllMocks());

const CATALOGUE = "BP number must be exactly 10-digit numeric";
const MESSAGE = "BP number must be 1-10 uppercase letters or digits";

const finding = {
  id: "f1", version_id: "v1", module: "business_partner", check_id: "BP002", severity: "critical", dimension: "validity",
  affected_count: 3881, total_count: 103030, pass_rate: 96.23, details: { message: MESSAGE }, check_class: "regex_check",
} as unknown as Finding;
const ranked: RuleRow = {
  check_id: "BP002", name: MESSAGE, module: "business_partner", severity: "critical", dimension: "validity", field: null,
  affected: 3881, total: 103030, pass_rate: 0.96, impact: 31048, auto_fix_pct: 0, s4: "blocking", delta_affected: null, cost_at_risk: null,
};

/** The lookup object pages, compare's drawer and Process pass the row's message to. */
function Lookup({ message }: { message?: string }) {
  const nameOf = useRuleNames(["BP002"]);
  return <span data-testid="lookup">{nameOf("BP002", message) ?? "BP002"}</span>;
}

describe("one name per check id across surfaces", () => {
  it("names BP002 by its catalogue name on every surface, never by the finding's own message", async () => {
    vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({ names: { BP002: `BP002: ${CATALOGUE}` }, generated: {} });
    renderWithQuery(
      <>
        <div data-testid="run-tab"><RuleCell id="BP002" fallback={MESSAGE} /></div>
        <div data-testid="rule-name"><RuleName id="BP002" fallback={MESSAGE} /></div>
        <div data-testid="exec"><DataTable columns={currentFindingColumns} data={[finding]} getRowId={(f) => f.id} /></div>
        <div data-testid="ranking"><DataTable columns={ruleColumns("v1", true)} data={[ranked]} getRowId={(r) => r.check_id} /></div>
        <Lookup message={MESSAGE} />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText(CATALOGUE)).toHaveLength(5));
    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(screen.getByTestId("lookup")).toHaveTextContent(CATALOGUE);
  });

  it("names a generated check the catalogue does not hold by the engine's words, the row's message first", async () => {
    vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({
      names: {}, generated: { "DT-MARA-ERSDA": "Creation date (MARA.ERSDA) is before 1970 or in the future" },
    });
    renderWithQuery(
      <>
        <RuleCell id="DT-MARA-ERSDA" />
        <RuleName id="DT-MARA-ERSDA" />
        <RuleCell id="DT-MARA-ERSDA" fallback="Stored message of this run" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText("Creation date (MARA.ERSDA) is before 1970 or in the future")).toHaveLength(2));
    expect(screen.getByText("Stored message of this run")).toBeInTheDocument();
  });

  it("puts the id whole on its own line and the words under it in at most two lines", async () => {
    vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({ names: { BP002: CATALOGUE }, generated: {} });
    const { container } = renderWithQuery(<RuleCell id="BP002" />);
    const words = await screen.findByText(CATALOGUE);
    expect(words).toHaveClass("line-clamp-2");
    const cell = container.querySelector("[data-rule-cell]");
    expect(cell).toHaveClass("flex-col");
    expect(cell).toHaveAttribute("title", CATALOGUE);
    expect(screen.getByText("BP002").closest(".whitespace-nowrap")).not.toBeNull();
  });
});
