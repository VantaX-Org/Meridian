import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { DATA_SECTIONS } from "../data";
import { MappingsSection } from "../data-mappings";
import { ReferenceSection } from "../data-reference";
import { AuditSection } from "../data-audit";
import { ContactVerifySection } from "../data-contact";
import { MatchRulesSection } from "../data-match";
import { RuleAccuracySection } from "../data-accuracy";
import { ConfigBundleSection, RulesIoSection, StewardshipSection } from "../data-capabilities";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const ok = <T,>(data: T) => ({ data, isPending: false, isLoading: false, isError: false, isSuccess: true, error: null, refetch: () => Promise.resolve() });
const waiting = () => ({ data: undefined, isPending: true, isLoading: true, isError: false, isSuccess: false, error: null, refetch: () => Promise.resolve() });

const S = vi.hoisted(() => ({
  can: (() => true) as (p: string) => boolean,
  resetFieldMappings: vi.fn(),
  uploadReference: vi.fn(),
  deleteReference: vi.fn(),
  exportAudit: vi.fn(),
  putContactVerification: vi.fn(),
  simulateMatchRules: vi.fn(),
  uploadKnownIssues: vi.fn(),
  applyTemplate: vi.fn(),
  exportBundle: vi.fn(),
  exportRulesBulk: vi.fn(),
}));

vi.mock("@/lib/v2/hooks", async (orig) => ({
  ...(await orig<object>()),
  useV2Session: () => ({ can: S.can, id: "u-self", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }),
  useOpenItem: () => ({ openItem: vi.fn() }),
}));

const mapping = { id: "m1", module: "material_master", standard_field: "MATNR", standard_label: "Material number", customer_field: "PART_NO", customer_label: "Part", notes: null, data_type: "string", is_mapped: true };
const system = { id: "sys-1", name: "ECC production" };

vi.mock("@/lib/v2/admin-queries", () => ({
  refreshAdmin: () => Promise.resolve(),
  useMappings: () => ok({ mappings: [mapping], self_service_enabled: true }),
  useReference: () => ok([{ kind: "postal-codes", records: 1200, countries: ["DE", "ZA"] }]),
  useAudit: () =>
    ok({
      entries: [{ id: "a1", created_at: "2026-11-01T10:00:00Z", actor_user_id: "u-1", actor_email: "ann@example.com", action: "user.invite", entity_type: "user", entity_id: "u-2", status_code: 200, method: "POST", path: "/users", details: {} }],
      total: 1,
    }),
  useAuditActors: () => ok({ actors: [{ id: "u-1", name: "Ann Steward" }] }),
  useRuleAccuracy: () => waiting(),
  useRuleTuning: () => ok({ proposals: [] }),
  useScorecard: () => waiting(),
}));
vi.mock("@/lib/v2/runs-queries", () => ({ useSystemsExtended: () => ok([system]) }));
vi.mock("@/lib/api/v2/admin", () => ({
  resetFieldMappings: S.resetFieldMappings,
  createFieldMapping: vi.fn(),
  uploadReference: S.uploadReference,
  deleteReference: S.deleteReference,
  exportAudit: S.exportAudit,
  getAiAudit: () => Promise.resolve({ entries: [], total: 0 }),
  getAuditSummary: () => Promise.resolve({ total: 1, summary: [{ entity_type: "user", count: 1 }] }),
}));

const contact = {
  settings: { mx: false },
  rules: [
    {
      check_id: "BP_EMAIL_SYNTAX",
      module: "business_partner",
      message: "Email address is well formed",
      field: "SMTP_ADDR",
      affected: 1,
      total: 10,
      pass_rate: 0.9,
      reasons: { syntax: { text: "Not a valid address", count: 1 } },
      fixes: 0,
      samples: [{ record_key: "1000042", value: "ann@", reason_text: "Not a valid address" }],
      checked_at: null,
    },
  ],
};
vi.mock("@/lib/v2/step9-queries", () => ({ useContactVerification: () => ok(contact), refreshStep9: () => Promise.resolve() }));
vi.mock("@/lib/api/v2/step9", () => ({ putContactVerification: S.putContactVerification }));

vi.mock("@/lib/api/v2/match-rules", async (orig) => ({
  ...(await orig<object>()),
  listMatchRules: () => Promise.resolve({ rules: [{ id: "r1", tenant_id: "t", domain: "customer_master", field: "NAME1", match_type: "fuzzy", weight: 40, threshold: 0.85, active: true }], total: 1 }),
  listProposedRules: () => Promise.resolve({ proposals: [] }),
  simulateMatchRules: S.simulateMatchRules,
  createMatchRule: vi.fn(),
  updateMatchRule: vi.fn(),
  deleteMatchRule: vi.fn(),
  approveProposedRule: vi.fn(),
  rejectProposedRule: vi.fn(),
}));
vi.mock("@/lib/api/v2/pilot", () => ({ uploadKnownIssues: S.uploadKnownIssues, draftTunedVersion: vi.fn() }));

const template = {
  template: { objects: { material_master: { owner_role: "Data owner", owner_user_id: null, slice: "plant", steward_user_id: null, stewards: "Plant teams" } } },
  saved: false,
  labels: { material_master: "Material master" },
  active_slices: { plant: ["1000"] },
};
vi.mock("@/lib/v2/roles-queries", () => ({
  refreshRoles: () => Promise.resolve(),
  useTemplate: () => ok(template),
  useTemplateGaps: () => ok({ gaps: [], objects: 1 }),
  useStewardAssignments: () => ok({ assignments: [] }),
}));
vi.mock("@/lib/v2/approvals-queries", () => ({ useAssignable: () => ok([{ id: "u-1", name: "Ann Steward" }]) }));
vi.mock("@/lib/api/v2/roles", () => ({
  applyTemplate: S.applyTemplate,
  putTemplate: vi.fn(),
  exportBundle: S.exportBundle,
  importBundle: vi.fn(),
  exportRulesBulk: S.exportRulesBulk,
  importRulesBulk: vi.fn(),
}));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  setUrl("/more/admin/mappings?fixture=1");
  S.can = () => true;
  for (const f of [S.resetFieldMappings, S.uploadReference, S.deleteReference, S.exportAudit, S.putContactVerification, S.simulateMatchRules, S.uploadKnownIssues, S.applyTemplate, S.exportBundle, S.exportRulesBulk]) f.mockReset();
});
afterEach(() => undo());
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

describe("data registry", () => {
  it("holds every slug of the group", () => {
    expect(Object.keys(DATA_SECTIONS).sort()).toEqual(["audit", "configbundle", "contactverify", "mappings", "matchrules", "reference", "ruleaccuracy", "rulesio", "stewardship"]);
  });
});

describe("field mappings", () => {
  it("lists mappings with code and text, and resets after confirming", async () => {
    S.resetFieldMappings.mockResolvedValue({ reset_count: 1 });
    wrap(<MappingsSection />);
    expect(screen.getByText("MATNR")).toBeInTheDocument();
    expect(screen.getAllByText("Material number").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("mapping-reset"));
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(S.resetFieldMappings).toHaveBeenCalledWith(undefined));
  });
});

describe("reference data", () => {
  it("shows the lists and uploads a pasted CSV", async () => {
    S.uploadReference.mockResolvedValue({ kind: "postal-codes", records: 2, countries: ["DE"] });
    wrap(<ReferenceSection />);
    expect(screen.getByText("DE, ZA")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("reference-csv"), { target: { value: "DE,10115\nDE,10117" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload the list" }));
    await waitFor(() => expect(S.uploadReference).toHaveBeenCalledWith("sys-1", "postal-codes", "DE,10115\nDE,10117"));
  });
});

describe("audit log", () => {
  it("shows events and exports CSV", async () => {
    S.exportAudit.mockResolvedValue(undefined);
    wrap(<AuditSection />);
    expect(screen.getByText("user.invite")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("audit-export-csv"));
    await waitFor(() => expect(S.exportAudit).toHaveBeenCalledWith("csv", expect.any(Object)));
  });

  it("asks for access without the audit permission", () => {
    S.can = () => false;
    wrap(<AuditSection />);
    expect(screen.getByTestId("needs-permission")).toBeInTheDocument();
  });
});

describe("contact verification", () => {
  it("shows each rule with its reasons and saves the mail server switch", async () => {
    S.putContactVerification.mockResolvedValue({ mx: true });
    wrap(<ContactVerifySection />);
    expect(screen.getByTestId("contact-rule-BP_EMAIL_SYNTAX")).toBeInTheDocument();
    expect(screen.getAllByText("Not a valid address").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /mail server/i }));
    await waitFor(() => expect(S.putContactVerification).toHaveBeenCalledWith(true));
  });
});

describe("match rules", () => {
  it("lists rules per object and simulates", async () => {
    S.can = (p) => p !== "review_ai_rules";
    S.simulateMatchRules.mockResolvedValue({ total_pairs: 10, auto_merge_count: 2, auto_dismiss_count: 5, queue_count: 3 });
    wrap(<MatchRulesSection />);
    expect(await screen.findByTestId("mr-domain-customer_master")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mr-simulate-customer_master"));
    await waitFor(() => expect(S.simulateMatchRules).toHaveBeenCalledWith("customer_master"));
    expect(await screen.findByTestId("mr-sim")).toBeInTheDocument();
  });
});

describe("rule accuracy", () => {
  it("shows the tuning state and uploads known bad records", async () => {
    S.uploadKnownIssues.mockResolvedValue({ records: 2, rejected: 0 });
    wrap(<RuleAccuracySection />);
    expect(screen.getByText("No rule needs tuning, or no pattern in the verdicts explains its false positives.")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("known-csv"), { target: { value: "material_master,1000|A" } });
    fireEvent.click(screen.getByTestId("known-upload"));
    await waitFor(() => expect(S.uploadKnownIssues).toHaveBeenCalledWith("sys-1", "material_master,1000|A"));
  });
});

describe("stewardship", () => {
  it("shows the template and checks what applying does", async () => {
    S.applyTemplate.mockResolvedValue({ owners: [{ module: "material_master", change: "add" }], stewards: [], totals: { add: 1, change: 0, same: 0 } });
    wrap(<StewardshipSection />);
    expect(screen.getByTestId("template-table")).toHaveTextContent("Material master");
    fireEvent.click(screen.getByTestId("template-check"));
    await waitFor(() => expect(S.applyTemplate).toHaveBeenCalledWith(true));
    expect(await screen.findByTestId("template-diff")).toBeInTheDocument();
  });
});

describe("configuration bundle", () => {
  it("downloads the bundle", async () => {
    S.exportBundle.mockResolvedValue(undefined);
    wrap(<ConfigBundleSection />);
    expect(screen.getByText("Download the bundle")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("bundle-export"));
    await waitFor(() => expect(S.exportBundle).toHaveBeenCalled());
  });
});

describe("rules import and export", () => {
  it("downloads the rules as YAML", async () => {
    S.exportRulesBulk.mockResolvedValue(undefined);
    wrap(<RulesIoSection />);
    expect(screen.getByText("Download the rules")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("rules-export"));
    await waitFor(() => expect(S.exportRulesBulk).toHaveBeenCalledWith("yaml"));
  });
});
