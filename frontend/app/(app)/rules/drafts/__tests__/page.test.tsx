import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import * as authoring from "@/lib/api/rule-authoring";
import type { RuleDraft } from "@/lib/api/rules";
import RuleDraftsPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
  vi.spyOn(api, "getRuleCoverage").mockResolvedValue({ objects: [{ module: "accounts_payable", by_dimension: {}, total: 1, never_run: 0 }], dimensions: [], check_classes: [], totals: { shipped: 0, rules: 0, enabled: 0, customer: 0, objects: 1, thin_cells: 0, never_run: 0 } });
});

describe("rules drafts page", () => {
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
});
