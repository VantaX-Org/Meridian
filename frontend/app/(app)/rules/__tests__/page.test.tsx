import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import RulesPage from "../page";

const h = vi.hoisted(() => ({
  can: (() => true) as (action: string) => boolean,
  dayOne: { status: "ready", step: null, error: null as unknown, refetch: () => {} },
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.can(a) }) }));
// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => h.dayOne,
  DayOneAction: () => null,
}));
// Stable instance across re-renders: useUrlState's sync effect depends on this
// object's identity, so returning a fresh URLSearchParams on every call would
// make it reset state back to the URL (which the replace() mock below never
// actually updates) right after every selection.
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/rules",
  useSearchParams: () => searchParams,
}));

const RULE: Rule = {
  id: "r1", name: "AP001: Vendor number is mandatory", description: null, module: "business_partner",
  category: "ecc", severity: "high", enabled: true, conditions: [{ field: "LFA1.STCD1", check_class: "null_check" }],
  thresholds: null, tags: null, source_yaml: "ap.yaml", source: "yaml", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", last_pass_rate: null, last_run_at: null,
};

describe("rules page", () => {
  it("renders rules once loaded", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText("Vendor number is mandatory")).toBeInTheDocument());
  });

  it("has one search and one export, with the secondary filters behind Filters", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText("Vendor number is mandatory")).toBeInTheDocument());
    expect(screen.getAllByRole("textbox", { name: /search|filter/i })).toHaveLength(1);
    expect(screen.queryByPlaceholderText("Type to filter rows")).toBeNull();
    // The catalogue's own export is the only one above it: no stray Export in the filter row.
    expect(within(screen.getByRole("region", { name: "Rule catalogue" })).getAllByRole("button", { name: /^export/i }).map((b) => b.textContent)).toEqual(["Export table"]);
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();

    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: "Authority" })).toBeNull();
    await userEvent.setup().click(filters);
    expect(filters).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("combobox", { name: "Authority" })).toBeInTheDocument();
  });

  it("shows a retryable error when rules fail to load", async () => {
    const spy = vi.spyOn(rulesApi, "getRules").mockRejectedValue(new Error("network down"));
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    retry.click();
    await waitFor(() => expect(screen.getByText("Vendor number is mandatory")).toBeInTheDocument());
  });

  it("shows \"—\" in the stats above a failed read, never zeros", async () => {
    vi.spyOn(rulesApi, "getRules").mockRejectedValue(new Error("network down"));
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await screen.findByText(/could not reach the server/i);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("sends only a manage_settings user to settings from an empty library", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [], total: 0, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    h.can = (a) => a !== "manage_settings";
    try {
      renderWithQuery(<RulesPage />);
      expect(await screen.findByText("No rules loaded")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
      expect(screen.getByText(/ask an administrator to check HQ sync/i)).toBeInTheDocument();
    } finally {
      h.can = () => true;
    }
  });

  it("treats a failed day-one read as unknown: coverage shows the error, not \"measured on a finished run\"", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    const refetch = vi.fn();
    h.dayOne = { status: "error", step: null, error: Object.assign(new Error("x"), { isAxiosError: true, response: { status: 500, data: {} } }), refetch };
    try {
      renderWithQuery(<RulesPage />);
      expect(await screen.findByText("The server could not complete the request.")).toBeInTheDocument();
      expect(screen.queryByText("Coverage is measured on a finished run")).toBeNull();
      screen.getByRole("button", { name: "Retry" }).click();
      expect(refetch).toHaveBeenCalled();
    } finally {
      h.dayOne = { status: "ready", step: null, error: null, refetch: () => {} };
    }
  });

  it("narrows the list to a material master view once one is selected", async () => {
    const batch: Rule = {
      ...RULE, id: "r2", name: "MM101: Batch class is mandatory", module: "material_master",
      conditions: [{ field: "MCH1.ZZBATCHCLASS", check_class: "null_check" }],
    };
    const units: Rule = {
      ...RULE, id: "r3", name: "MM201: Base unit of measure is mandatory", module: "material_master",
      conditions: [{ field: "MARM.MEINH", check_class: "null_check" }],
    };
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE, batch, units], total: 3, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText("Base unit of measure is mandatory")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Object" }));
    const objectOption = await screen.findByRole("option", { name: "Material master" });
    await waitFor(() => expect(objectOption.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(objectOption);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Object" })).toHaveTextContent("Material master"));
    await waitFor(() => expect(screen.queryByText("Vendor number is mandatory")).not.toBeInTheDocument());
    expect(screen.getByText("Base unit of measure is mandatory")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "View" }));
    const viewOption = await screen.findByRole("option", { name: "Batch management" });
    await waitFor(() => expect(viewOption.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(viewOption);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "View" })).toHaveTextContent("Batch management"));
    await waitFor(() => expect(screen.queryByText("Base unit of measure is mandatory")).not.toBeInTheDocument());
    expect(screen.getByText("Batch class is mandatory")).toBeInTheDocument();
  });
});

describe("rules page state param", () => {
  it.each(["garbage", "constructor"])("ignores ?state=%s: enabled and disabled rules, no banner", async (v) => {
    searchParams.set("state", v);
    const off: Rule = { ...RULE, id: "r9", name: "AP009: Disabled rule", enabled: false };
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE, off], total: 2, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText("Vendor number is mandatory")).toBeInTheDocument());
    expect(screen.getByText("Disabled rule")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    searchParams.delete("state");
  });
});

describe("rule enable switch", () => {
  it("toggles optimistically and rolls back when the update fails", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    const update = vi.spyOn(rulesApi, "updateRule").mockRejectedValue(new Error("nope"));
    renderWithQuery(<RulesPage />);
    const sw = await screen.findByRole("switch", { name: "On: Vendor number is mandatory" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    await userEvent.setup().click(sw);
    expect(update).toHaveBeenCalledWith("r1", { enabled: false });
    await waitFor(() => expect(screen.getByRole("switch", { name: /: Vendor number is mandatory$/ })).toHaveAttribute("aria-checked", "true"));
  });

  it("flips the switch state when the update succeeds", async () => {
    let enabled = true;
    vi.spyOn(rulesApi, "getRules").mockImplementation(async () => ({ rules: [{ ...RULE, enabled }], total: 1, limit: 1000, offset: 0 }));
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    vi.spyOn(rulesApi, "updateRule").mockImplementation(async () => { enabled = false; return { ...RULE, enabled }; });
    renderWithQuery(<RulesPage />);
    const sw = await screen.findByRole("switch", { name: /: Vendor number is mandatory$/ });
    await userEvent.setup().click(sw);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Off: Vendor number is mandatory" })).toHaveAttribute("aria-checked", "false"));
  });
});
