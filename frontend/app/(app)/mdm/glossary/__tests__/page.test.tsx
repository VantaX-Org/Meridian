// frontend/app/(app)/mdm/glossary/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import * as glossaryApi from "@/lib/api/glossary";
import * as rulesApi from "@/lib/api/rules";
import type { CoverageMatrix } from "@/lib/api/rules";
import GlossaryPage from "../page";

const mockParams = vi.hoisted(() => ({ value: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockParams.replace }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(mockParams.value),
}));

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const coverage = (modules: string[]) => ({ objects: modules.map((module) => ({ module })), dimensions: [], check_classes: [], totals: { shipped: 0, rules: 0, enabled: 0, customer: 0, objects: modules.length, thin_cells: 0, never_run: 0 } }) as unknown as CoverageMatrix;

describe("GlossaryPage", () => {
  beforeEach(() => { vi.spyOn(rulesApi, "getRuleCoverage").mockResolvedValue(coverage([])); });

  it("drafts terms from analysed objects when the glossary is empty", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 100 });
    const populate = vi.spyOn(glossaryApi, "populateGlossary").mockResolvedValue({ created: 412, linked: 600, objects: 5 });
    renderWithQuery(<GlossaryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Draft terms from analysed objects" }));
    await waitFor(() => expect(populate).toHaveBeenCalled());
  });


  it("renders one row per glossary term", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({
      terms: [
        {
          id: "t1",
          sap_table: "MARA",
          sap_field: "MATKL",
          technical_name: "MATKL",
          business_name: "Material group",
          domain: "material_master",
          mandatory_for_s4hana: true,
          status: "active",
          ai_drafted: false,
          last_reviewed_at: null,
          review_cycle_days: 90,
          linked_rules_count: 2,
        },
      ],
      total: 1,
      page: 1,
      per_page: 100,
    });
    renderWithQuery(<GlossaryPage />);
    await waitFor(() => expect(screen.getByText("Material group")).toBeInTheDocument());
  });

  it("shows an empty state when no terms match", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 100 });
    renderWithQuery(<GlossaryPage />);
    await waitFor(() => expect(screen.getByText(/no terms yet/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockRejectedValue(new Error("glossary service unavailable"));
    renderWithQuery(<GlossaryPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (glossaryApi.getGlossaryTerms as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((glossaryApi.getGlossaryTerms as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it("clears every filter in one URL replace", async () => {
    mockParams.value = "domain=material_master&status=active&q=grp&keep=1";
    mockParams.replace.mockClear();
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 100 });
    renderWithQuery(<GlossaryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(mockParams.replace).toHaveBeenCalledTimes(1);
    expect(mockParams.replace.mock.calls[0]?.[0]).toBe("/x?keep=1");
    mockParams.value = "";
  });

  it("pages through every term and reads the page from the URL", async () => {
    mockParams.value = "page=2";
    mockParams.replace.mockClear();
    const get = vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({
      terms: [{ id: "t1", sap_table: "MARA", sap_field: "MATKL", technical_name: "MATKL", business_name: "Material group", domain: "material_master", mandatory_for_s4hana: false, status: "active", ai_drafted: false, last_reviewed_at: null, review_cycle_days: 90, linked_rules_count: 0 }],
      total: 250, page: 2, per_page: 100,
    });
    renderWithQuery(<GlossaryPage />);
    expect(await screen.findByText("101\u2013200 of 250")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ page: 2, per_page: 100 }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(mockParams.replace).toHaveBeenLastCalledWith("/x?page=3", { scroll: false });
    mockParams.value = "";
  });

  it("offers every object from the rule catalogue, not only those on the page", async () => {
    vi.spyOn(rulesApi, "getRuleCoverage").mockResolvedValue(coverage(["fi_gl", "material_master"]));
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 100 });
    renderWithQuery(<GlossaryPage />);
    await waitFor(() => expect(rulesApi.getRuleCoverage).toHaveBeenCalled());
    await userEvent.setup().click(screen.getAllByRole("combobox")[0]!);
    expect(await screen.findByRole("option", { name: "FI general ledger" })).toBeInTheDocument();
  });
});
