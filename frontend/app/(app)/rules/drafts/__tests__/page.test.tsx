import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import * as authoring from "@/lib/api/rule-authoring";
import * as matchRules from "@/lib/api/match-rules";
import type { RuleDraft } from "@/lib/api/rules";
import type { AIProposedRule } from "@/types/api";
import RuleDraftsPage from "../page";

const perms = vi.hoisted(() => ({ manageRules: true, reviewAi: true }));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({
    can: (a: string) => (a === "manage_rules" ? perms.manageRules : a === "review_ai_rules" ? perms.reviewAi : true),
  }),
}));
const access = vi.hoisted(() => ({ requestAccess: null as null | ((t: unknown) => void) }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissionsContext: () => (access.requestAccess ? { loading: false, can: () => true, has: () => true, requestAccess: access.requestAccess } : null),
}));
const nav = vi.hoisted(() => ({ params: new URLSearchParams("") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/rules/drafts" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROPOSAL: AIProposedRule = {
  id: "ap1",
  tenant_id: "t1",
  domain: "business_partner",
  proposed_rule: { field: "BUT000.NAME_ORG1", match_type: "fuzzy", weight: 60, threshold: 0.9 },
  rationale: "Stewards merged 12 pairs the matcher missed on organisation name",
  supporting_correction_count: 12,
  status: "pending",
  reviewed_by: null,
  reviewed_at: null,
  created_at: "2026-10-20T00:00:00Z",
};

const DRAFT: RuleDraft = {
  id: "d1",
  domain: "dq_rule:accounts_payable",
  proposed_rule: { id: "ZR-1", field: "LFA1.STCD1", check_class: "null_check", severity: "high", dimension: "completeness", message: "VAT number missing" },
  rationale: "AI-assisted draft",
  status: "draft",
  created_at: "2026-10-10T00:00:00Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
  access.requestAccess = null;
  perms.manageRules = true;
  perms.reviewAi = true;
  nav.params = new URLSearchParams("");
  vi.spyOn(matchRules, "getProposedRules").mockResolvedValue({ rules: [], total: 0 });
  vi.spyOn(api, "getRuleCoverage").mockResolvedValue({ objects: [{ module: "accounts_payable", by_dimension: {}, total: 1, never_run: 0 }], dimensions: [], check_classes: [], totals: { shipped: 0, rules: 0, enabled: 0, customer: 0, objects: 1, thin_cells: 0, never_run: 0 } });
});

describe("rules drafts page", () => {
  it("says drafts need manage_rules, and never reads them, for a user with neither manage_rules nor review_ai_rules", async () => {
    perms.manageRules = false;
    perms.reviewAi = false;
    const read = vi.spyOn(api, "getRuleDrafts").mockResolvedValue([]);
    renderWithQuery(<RuleDraftsPage />);
    expect(await screen.findByText("Rule drafts need the manage-rules permission")).toBeInTheDocument();
    expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to rules" })).toHaveAttribute("href", "/rules");
    expect(read).not.toHaveBeenCalled();
    expect(matchRules.getProposedRules).not.toHaveBeenCalled();
  });

  it("shows the AI reviewer (review_ai_rules without manage_rules) only the Proposed by AI tab, with its evidence", async () => {
    perms.manageRules = false;
    const read = vi.spyOn(api, "getRuleDrafts").mockResolvedValue([]);
    vi.spyOn(matchRules, "getProposedRules").mockResolvedValue({ rules: [PROPOSAL], total: 1 });
    renderWithQuery(<RuleDraftsPage />);
    expect(await screen.findByText("BUT000.NAME_ORG1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /proposed by ai/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^drafts/i })).toBeNull();
    expect(screen.getByText("12 steward corrections")).toBeInTheDocument();
    expect(screen.getByText(/merged 12 pairs/)).toBeInTheDocument();
    expect(screen.queryByText("Rule drafts need the manage-rules permission")).toBeNull();
    expect(screen.queryByRole("button", { name: "New draft" })).toBeNull();
    expect(matchRules.getProposedRules).toHaveBeenCalledWith("pending");
    expect(read).not.toHaveBeenCalled();
  });

  it("approves a proposal", async () => {
    perms.manageRules = false;
    vi.spyOn(matchRules, "getProposedRules").mockResolvedValue({ rules: [PROPOSAL], total: 1 });
    const approve = vi.spyOn(matchRules, "approveProposedRule").mockResolvedValue({ id: "ap1", status: "approved", match_rule_id: "m1" });
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Approve BUT000.NAME_ORG1" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("ap1"));
  });

  it("rejects a proposal only with a reason", async () => {
    perms.manageRules = false;
    vi.spyOn(matchRules, "getProposedRules").mockResolvedValue({ rules: [PROPOSAL], total: 1 });
    const reject = vi.spyOn(matchRules, "rejectProposedRule").mockResolvedValue({ id: "ap1", status: "rejected" });
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Reject BUT000.NAME_ORG1" }));
    const confirm = await screen.findByRole("button", { name: "Reject proposal" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), "Too sparse to match on");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(reject).toHaveBeenCalledWith("ap1", "Too sparse to match on"));
  });

  it("gives a user with both permissions both tabs and opens the AI tab from ?tab=ai", async () => {
    nav.params = new URLSearchParams("tab=ai");
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([DRAFT]);
    vi.spyOn(matchRules, "getProposedRules").mockResolvedValue({ rules: [PROPOSAL], total: 1 });
    renderWithQuery(<RuleDraftsPage />);
    expect(await screen.findByText("BUT000.NAME_ORG1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^drafts/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /proposed by ai/i })).toHaveAttribute("aria-selected", "true");
  });

  it("hides the AI tab from a rule writer without review_ai_rules and never reads proposals", async () => {
    perms.reviewAi = false;
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([DRAFT]);
    renderWithQuery(<RuleDraftsPage />);
    expect(await screen.findByText("ZR-1")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /proposed by ai/i })).toBeNull();
    expect(matchRules.getProposedRules).not.toHaveBeenCalled();
  });

  it("shows the empty sentence when there are no drafts", async () => {
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([]);
    renderWithQuery(<RuleDraftsPage />);
    expect(await screen.findByText("No drafts")).toBeInTheDocument();
  });

  it("shows a loading skeleton while drafts load", () => {
    vi.spyOn(api, "getRuleDrafts").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<RuleDraftsPage />);
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
  });

  it("opens a draft, dry runs it and shows the matched rows", async () => {
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([DRAFT]);
    const dry = vi.spyOn(authoring, "dryRunRuleDraft").mockResolvedValue({ version_id: "v1", evaluated: true, hits: 12, population: 400, pass_rate: 0.97, sample: [{ record_key: "LIFNR=100" }] });
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click(await screen.findByText("ZR-1"));
    await userEvent.click(await screen.findByRole("button", { name: "Dry run" }));
    await waitFor(() => expect(dry).toHaveBeenCalled());
    expect(dry.mock.calls[0][0].module).toBe("accounts_payable");
    expect(JSON.parse(dry.mock.calls[0][0].rule_yaml).id).toBe("ZR-1");
    expect(await screen.findByTestId("dry-run-result")).toBeInTheDocument();
    expect(screen.getByText("LIFNR=100")).toBeInTheDocument();
  });

  it("publishes a saved draft", async () => {
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([DRAFT]);
    const publish = vi.spyOn(authoring, "publishRuleDraft").mockResolvedValue({ id: "r1", name: "ZR-1: VAT number missing", module: "accounts_payable", severity: "high", enabled: true, draft_id: "d1" });
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click(await screen.findByText("ZR-1"));
    await userEvent.click(await screen.findByRole("button", { name: "Publish rule" }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith("d1"));
  });

  it("deletes a draft only after the confirm dialog", async () => {
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([DRAFT]);
    const del = vi.spyOn(authoring, "deleteRuleDraft").mockResolvedValue();
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click(await screen.findByText("ZR-1"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete draft" }));
    expect(del).not.toHaveBeenCalled();
    const buttons = await screen.findAllByRole("button", { name: "Delete draft" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(del).toHaveBeenCalledWith("d1"));
  });

  it("generates with AI into the form without saving", async () => {
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([]);
    const gen = vi.spyOn(authoring, "generateRuleDraft").mockResolvedValue({
      rule_yaml: "",
      rule: { id: "ZR-9", field: "LFA1.LAND1", check_class: "null_check", severity: "low", dimension: "completeness", message: "Country missing" },
      valid: true,
      errors: [],
    });
    const create = vi.spyOn(authoring, "createRuleDraft");
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click((await screen.findAllByRole("button", { name: "New draft" }))[0]);
    // choose the object, then describe the rule
    await userEvent.click(await screen.findByRole("combobox", { name: "Object" }));
    await userEvent.click(await screen.findByRole("option", { name: /accounts payable/i }));
    await userEvent.type(screen.getByLabelText("Describe the rule"), "Country must be filled");
    await userEvent.click(screen.getByRole("button", { name: /generate with ai/i }));
    await waitFor(() => expect(gen).toHaveBeenCalledWith({ module: "accounts_payable", description: "Country must be filled" }));
    expect(await screen.findByText("AI-drafted rule")).toBeInTheDocument();
    expect(screen.getByLabelText("Rule id")).toHaveValue("ZR-9");
    expect(create).not.toHaveBeenCalled();
  });

  it("offers Request access for the manage-rules permission to someone who has neither", async () => {
    perms.manageRules = false;
    perms.reviewAi = false;
    const requestAccess = vi.fn();
    access.requestAccess = requestAccess;
    vi.spyOn(api, "getRuleDrafts").mockResolvedValue([]);
    renderWithQuery(<RuleDraftsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Request manage-rules access" }));
    expect(requestAccess).toHaveBeenCalledWith({ resource: "rules", action: "edit" });
  });

});
