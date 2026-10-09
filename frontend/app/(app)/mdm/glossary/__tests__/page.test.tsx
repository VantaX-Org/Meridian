// frontend/app/(app)/mdm/glossary/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as glossaryApi from "@/lib/api/glossary";
import GlossaryPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("GlossaryPage", () => {
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
      per_page: 200,
    });
    renderWithQuery(<GlossaryPage />);
    await waitFor(() => expect(screen.getByText("Material group")).toBeInTheDocument());
  });

  it("shows an empty state when no terms match", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 200 });
    renderWithQuery(<GlossaryPage />);
    await waitFor(() => expect(screen.getByText(/no glossary terms/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockRejectedValue(new Error("glossary service unavailable"));
    renderWithQuery(<GlossaryPage />);
    await screen.findByText("glossary service unavailable");
    const calls = (glossaryApi.getGlossaryTerms as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((glossaryApi.getGlossaryTerms as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
