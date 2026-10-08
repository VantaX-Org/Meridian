// frontend/app/(app)/mdm/glossary/[id]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as glossaryApi from "@/lib/api/glossary";
import type { GlossaryTermDetail } from "@/types/api";
import GlossaryTermPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
}));

const term: GlossaryTermDetail = {
  id: "t1",
  sap_table: "MARA",
  sap_field: "MATKL",
  technical_name: "MATKL",
  business_name: "Material group",
  business_definition: "Groups materials for reporting.",
  why_it_matters: null,
  sap_impact: null,
  domain: "material_master",
  approved_values: null,
  mandatory_for_s4hana: true,
  rule_authority: null,
  data_steward_id: null,
  review_cycle_days: 90,
  last_reviewed_at: null,
  status: "active",
  ai_drafted: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  linked_rules: [],
  change_history: [],
};

describe("GlossaryTermPage", () => {
  it("renders the term's business name and definition", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(term);
    renderWithQuery(<GlossaryTermPage />);
    await waitFor(() => expect(screen.getByText("Material group")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Groups materials for reporting.")).toBeInTheDocument();
  });

  it("shows an empty state when the term does not exist", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(null as unknown as GlossaryTermDetail);
    renderWithQuery(<GlossaryTermPage />);
    await waitFor(() => expect(screen.getByText(/no longer exists/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockRejectedValue(new Error("glossary term service unavailable"));
    renderWithQuery(<GlossaryTermPage />);
    await screen.findByText("glossary term service unavailable");
    const calls = (glossaryApi.getGlossaryTerm as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((glossaryApi.getGlossaryTerm as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
