import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import RulesPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
// Stable instance across re-renders: useUrlState's sync effect depends on this
// object's identity, so returning a fresh URLSearchParams on every call would
// make it reset state back to the URL (which the replace() mock below never
// actually updates) right after every selection.
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
    const objectOption = await screen.findByRole("option", { name: "Material Master" });
    await waitFor(() => expect(objectOption.closest("[role=listbox]")).toHaveAttribute("data-open"));
    await user.click(objectOption);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Object" })).toHaveTextContent("Material Master"));
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
