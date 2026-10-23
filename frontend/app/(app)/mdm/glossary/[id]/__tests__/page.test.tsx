// frontend/app/(app)/mdm/glossary/[id]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as glossaryApi from "@/lib/api/glossary";
import type { GlossaryTermDetail } from "@/types/api";
import GlossaryTermPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "t1" }),
}));

const perms = vi.hoisted(() => ({ granted: new Set<string>() }));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: (a: string) => perms.granted.has(a), loading: false }),
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
  beforeEach(() => {
    perms.granted = new Set(["view", "approve", "trigger_ai"]);
    vi.restoreAllMocks();
  });

  it("renders the term's business name and definition", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(term);
    renderWithQuery(<GlossaryTermPage />);
    await waitFor(() => expect(screen.getByText("Material group")).toBeInTheDocument());
    expect(screen.getByDisplayValue("Groups materials for reporting.")).toBeInTheDocument();
  });

  it("shows an empty state when the term does not exist", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(null as unknown as GlossaryTermDetail);
    renderWithQuery(<GlossaryTermPage />);
    await waitFor(() => expect(screen.getByText(/term not found/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockRejectedValue(new Error("glossary term service unavailable"));
    renderWithQuery(<GlossaryTermPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (glossaryApi.getGlossaryTerm as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((glossaryApi.getGlossaryTerm as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it("offers Mark reviewed, Auto-draft and Save to a role holding approve and trigger_ai", async () => {
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(term);
    renderWithQuery(<GlossaryTermPage />);
    const box = await screen.findByDisplayValue("Groups materials for reporting.");
    expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto-draft" })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "Groups materials." } });
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("hides Mark reviewed and Save from a role without approve", async () => {
    perms.granted = new Set(["view", "trigger_ai"]);
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(term);
    renderWithQuery(<GlossaryTermPage />);
    const box = await screen.findByDisplayValue("Groups materials for reporting.");
    expect(screen.queryByRole("button", { name: "Mark reviewed" })).toBeNull();
    expect(box).toHaveAttribute("readonly");
    fireEvent.change(box, { target: { value: "Groups materials." } });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("hides Auto-draft from a role without trigger_ai", async () => {
    perms.granted = new Set(["view", "approve"]);
    vi.spyOn(glossaryApi, "getGlossaryTerm").mockResolvedValue(term);
    renderWithQuery(<GlossaryTermPage />);
    await screen.findByDisplayValue("Groups materials for reporting.");
    expect(screen.queryByRole("button", { name: "Auto-draft" })).toBeNull();
  });
});
