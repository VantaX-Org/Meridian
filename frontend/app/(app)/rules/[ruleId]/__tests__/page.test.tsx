import { screen, waitFor } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import * as configLoadApi from "@/lib/api/config-load";
import type { RuleApplicability } from "@/lib/api/config-load";
import * as lineageApi from "@/lib/api/lineage";
import type { RuleLineage } from "@/lib/api/lineage";
import * as ownersApi from "@/lib/api/owners";
import * as usersApi from "@/lib/api/users";
import * as designerApi from "@/lib/api/process-designer";
import type { ProcessModelDocument } from "@/types/process-model";
import RulePage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ ruleId: "r1" }),
  useRouter: () => ({ push: vi.fn() }),
}));
const access = vi.hoisted(() => ({ requestAccess: null as null | ((t: unknown) => void) }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissionsContext: () => (access.requestAccess ? { loading: false, can: () => true, has: () => true, requestAccess: access.requestAccess } : null),
}));
let allowed = true;
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => allowed }) }));

const RULE: Rule = {
  id: "r1", name: "AP001: Vendor number is mandatory", description: null, module: "business_partner",
  category: "ecc", severity: "high", enabled: true, conditions: [{ field: "LFA1.STCD1", check_class: "null_check" }],
  thresholds: null, tags: null, source_yaml: "ap.yaml", source: "yaml", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", last_pass_rate: null, last_run_at: null,
};

const APPLICABILITY: RuleApplicability = {
  check_id: "r1",
  module: "business_partner",
  object: null,
  systems: [
    {
      system_id: "s1",
      name: "ECC PRD",
      system_type: "ecc",
      applicability: "applies",
      reason: null,
      object: null,
      configured_in: [{ object: "LFA1", kind: "img", path: "Financial Accounting > Vendor Master", tcode: "XK01" }],
    },
  ],
};

const LINEAGE: RuleLineage = {
  check_id: "AP001",
  module: "business_partner",
  fields: ["LFB1.LNRZE"],
  targets: ["LFA1.LIFNR"],
  tables: ["LFB1", "LFA1"],
  joins: [{ parent: "LFA1", child: "LFB1", on: [["LIFNR", "LIFNR"]], cardinality: "many" }],
  glossary_terms: [{ id: "g1", business_name: "Vendor number", sap_table: "LFA1", sap_field: "LIFNR" }],
  owners: [],
};

describe("rule detail page", () => {
  beforeEach(() => {
    allowed = true;
    access.requestAccess = null;
    vi.spyOn(lineageApi, "getRuleLineage").mockResolvedValue(LINEAGE);
    vi.spyOn(rulesApi, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [] });
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    vi.spyOn(rulesApi, "getRuleByCode").mockRejectedValue(new Error("not found"));
  });

  it("renders the rule once loaded", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("AP001: Vendor number is mandatory")).toBeInTheDocument());
  });

  it("lists the reference process steps the check gates, linked to readiness", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    const REF = { schema_version: 1, l1: [{ id: "PTP", name: "Procure to pay", description: "", order: 1, modules: ["accounts_payable"],
      l2: [{ id: "PTP-VM", name: "Vendors", description: "", order: 1, l3: [{ id: "PTP-VM-P1", name: "Onboarding", description: "", order: 1,
        l4: [{ id: "PTP-VM-FK01", name: "Create vendor", description: "", order: 1, tcode: "FK01", config_dependency: null, variants: [], diagram: { nodes: [], flows: [] },
          activities: [{ id: "a1", name: "Enter", description: "", order: 1, tcode: "FK01", check_ids: [], sap_tables: [],
            fields: [{ field: "LFA1.STCD1", check_id: "AP001", description: "", mandatory: true, config_source: null }] }] }] }] }] }] } as unknown as ProcessModelDocument;
    vi.spyOn(designerApi, "getReference").mockResolvedValue(REF);
    renderWithQuery(<RulePage />);
    const link = await screen.findByRole("link", { name: "Procure to pay: Create vendor" });
    // The rule's object is not a PTP object, so the link opens PTP over its first object, never another L1.
    expect(link.getAttribute("href")).toBe("/insights/process?l1=PTP&object=accounts_payable");
    expect(link.className).toContain("underline");
    expect(screen.getByText("Process steps it gates")).toBeInTheDocument();
  });

  it("renders where it applies, including the configured-in cell", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("ECC PRD")).toBeInTheDocument());
    expect(screen.getByText(/Financial Accounting > Vendor Master/)).toBeInTheDocument();
    expect(screen.getByText("XK01")).toBeInTheDocument();
  });

  it("shows a retryable error when the rule fails to load", async () => {
    const spy = vi.spyOn(rulesApi, "getRule").mockRejectedValue(new Error("network down"));
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(RULE);
    retry.click();
    await waitFor(() => expect(screen.getByText("AP001: Vendor number is mandatory")).toBeInTheDocument());
  });

  it("shows lineage and ownership by check id", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue({ ...RULE, last_pass_rate: 0.9, last_run_at: "2026-10-10T08:00:00Z" });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("LFB1.LNRZE")).toBeInTheDocument());
    expect(configLoadApi.getRuleApplicability).toHaveBeenCalledWith("AP001", "business_partner");
    expect(lineageApi.getRuleLineage).toHaveBeenCalledWith("AP001");
    expect(screen.getByText("LFA1 → LFB1 on LIFNR")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vendor number" })).toHaveAttribute("href", "/mdm/glossary/g1");
    expect(screen.getByRole("link", { name: "See failing records" })).toHaveAttribute(
      "href", "/objects/business_partner?tab=records&check_id=AP001",
    );
    await waitFor(() => expect(screen.getByText("No owner set.")).toBeInTheDocument());
  });

  it("explains that custom rules have no lineage", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue({ ...RULE, source: "custom" });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("Lineage is shown for built-in rules only.")).toBeInTheDocument());
    expect(lineageApi.getRuleLineage).not.toHaveBeenCalled();
  });

  it("shows an empty state and the history chart when runs exist", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({
      rule_id: "r1",
      runs: [{ version_id: "v1", run_at: "2026-01-01T00:00:00Z", module: "business_partner", severity: "high", affected_count: 1, total_count: 10, pass_rate: 0.9, suppressed: false, hit_rate: null }],
    });
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("Pass rate over runs")).toBeInTheDocument());
    expect(screen.queryByText("Not run yet")).not.toBeInTheDocument();
  });

  it("says in plain words what the rule checks, why it matters and how many records fail now", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    const byCode = vi.spyOn(rulesApi, "getRuleByCode").mockResolvedValue({
      message: "Every vendor has a tax number", why_it_matters: "Invoices without one are blocked for payment", sap_impact: "Payment run skips the vendor",
      field: "LFA1.STCD1", check_class: "null_check",
    } as rulesApi.RuleDetail);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({
      rule_id: "r1",
      runs: [{ version_id: "v1", run_at: "2026-01-01T00:00:00Z", module: "business_partner", severity: "high", affected_count: 12, total_count: 400, pass_rate: 0.97, suppressed: false, hit_rate: null }],
    });
    renderWithQuery(<RulePage />);
    expect(await screen.findByText("Every vendor has a tax number")).toBeInTheDocument();
    expect(byCode).toHaveBeenCalledWith("AP001", "business_partner");
    expect(screen.getByText("Invoices without one are blocked for payment")).toBeInTheDocument();
    expect(screen.getByText("Payment run skips the vendor")).toBeInTheDocument();
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fix them on the object" })).toHaveAttribute("href", "/objects/business_partner?tab=records&check_id=AP001");
  });

  it("opens a gated PTP step on the rule's own object in the newest run that evaluated it; another L1 opens its reference step", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue({ ...RULE, module: "accounts_payable" });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    const run = (version_id: string, pass_rate: number | null) => ({ version_id, run_at: "2026-01-01T00:00:00Z", module: "accounts_payable",
      severity: "high", affected_count: 1, total_count: 10, pass_rate, suppressed: false, hit_rate: null });
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [run("v-new", null), run("v-old", 0.9)] });
    const step = (l1: string, l4: string) => ({ id: l1, name: `${l1} process`, description: "", order: 1, modules: [],
      l2: [{ id: `${l1}-A`, name: "Area", description: "", order: 1, l3: [{ id: `${l1}-A-1`, name: "Step", description: "", order: 1,
        l4: [{ id: l4, name: `${l1} step`, description: "", order: 1, tcode: null, config_dependency: null, variants: [], diagram: { nodes: [], flows: [] },
          activities: [{ id: `${l4}-1`, name: "Do", description: "", order: 1, tcode: null, check_ids: ["AP001"], sap_tables: [], fields: [] }] }] }] }] });
    vi.spyOn(designerApi, "getReference").mockResolvedValue({ schema_version: 1, l1: [step("PTP", "PTP-A-1-1"), step("R2R", "R2R-A-1-1")] } as unknown as ProcessModelDocument);
    renderWithQuery(<RulePage />);
    const ptp = await screen.findByRole("link", { name: "PTP process: PTP step" });
    await waitFor(() => expect(ptp.getAttribute("href")).toBe("/insights/process?l1=PTP&object=accounts_payable&run=v-old"));
    expect(screen.getByRole("link", { name: "R2R process: R2R step" }).getAttribute("href")).toBe("/process/R2R?tab=reference&node=R2R-A-1-1");
  });

  it("leaves runs that did not evaluate the rule off the history line and says so", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    const run = (version_id: string, pass_rate: number | null) => ({ version_id, run_at: "2026-01-01T00:00:00Z", module: "business_partner",
      severity: "high", affected_count: 1, total_count: 10, pass_rate, suppressed: false, hit_rate: null });
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [run("v3", 0.8), run("v2", null), run("v1", 0.9)] });
    renderWithQuery(<RulePage />);
    expect(await screen.findByText(/1 run did not evaluate this rule and is left off the line\./)).toBeInTheDocument();
  });

  it("draws no line when no run evaluated the rule", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    const run = (version_id: string) => ({ version_id, run_at: "2026-01-01T00:00:00Z", module: "business_partner",
      severity: "high", affected_count: 0, total_count: 0, pass_rate: null, suppressed: false, hit_rate: null });
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [run("v2"), run("v1")] });
    renderWithQuery(<RulePage />);
    expect(await screen.findByText("No run has evaluated this rule yet (2 runs so far), so there is no line to draw.")).toBeInTheDocument();
  });

  it("shows the not-run-yet empty state when there is no history", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("Not run yet")).toBeInTheDocument());
  });

  it("shows a loading skeleton while the rule loads", async () => {
    vi.spyOn(rulesApi, "getRule").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<RulePage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
  });

  it("offers Run analysis, not See failing records, for a rule that has no result", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    expect(await screen.findByRole("button", { name: "Run analysis" })).toHaveClass("m-btn-primary");
    expect(screen.queryByRole("link", { name: "See failing records" })).toBeNull();
  });

  it("hides the button for a rule with no result when the viewer cannot run an analysis, and says how to ask for rule access", async () => {
    allowed = false;
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await screen.findByText(/This rule is read-only for you/);
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
    expect(screen.queryByRole("link", { name: "See failing records" })).toBeNull();
  });

  it("keeps See failing records once the rule has run", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue({ ...RULE, last_pass_rate: 0.9, last_run_at: "2026-10-10T08:00:00Z" });
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    expect(await screen.findByRole("link", { name: "See failing records" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
  });


  it("offers Request access on the read-only note of a rule", async () => {
    allowed = false;
    const requestAccess = vi.fn();
    access.requestAccess = requestAccess;
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await screen.findByText(/This rule is read-only for you/);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getAllByRole("button", { name: "Request access" })[0]);
    expect(requestAccess).toHaveBeenCalledWith({ resource: "rules", action: "edit" });
  });

});
