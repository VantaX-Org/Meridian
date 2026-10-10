// frontend/app/(app)/search/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import * as connectivityApi from "@/lib/api/connectivity";
import * as cleaningApi from "@/lib/api/cleaning";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as glossaryApi from "@/lib/api/glossary";
import SearchPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("q=business"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("SearchPage", () => {
  beforeEach(() => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 20 });
  });

  it("ranks a matching rule into the results table", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({
      rules: [
        {
          id: "r1",
          name: "Business partner VAT check",
          description: null,
          module: "business_partner",
          category: "validity",
          severity: "high",
          enabled: true,
          conditions: null,
          thresholds: null,
          tags: null,
          source_yaml: null,
          source: "yaml",
          created_at: "2026-10-08T00:00:00Z",
          updated_at: "2026-10-08T00:00:00Z",
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(cleaningApi, "getCleaningQueue").mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "", objects: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText("Business partner VAT check")).toBeInTheDocument());
  });

  it("shows an empty state when nothing matches", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [], total: 0, limit: 100, offset: 0 });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(cleaningApi, "getCleaningQueue").mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "", objects: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText(/no results for "business"/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(rulesApi, "getRules").mockRejectedValue(new Error("rules service unavailable"));
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(cleaningApi, "getCleaningQueue").mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "", objects: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });

    renderWithQuery(<SearchPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (rulesApi.getRules as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((rulesApi.getRules as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it("finds glossary terms", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [], total: 0, limit: 100, offset: 0 });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(cleaningApi, "getCleaningQueue").mockResolvedValue({ items: [], total: 0, page: 1, per_page: 500 });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "", objects: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({
      terms: [{
        id: "g1", sap_table: "BUT000", sap_field: "NAME_ORG1", technical_name: "BUT000.NAME_ORG1",
        business_name: "Business partner name", domain: "business_partner", mandatory_for_s4hana: true,
        status: "active", ai_drafted: false, last_reviewed_at: null, review_cycle_days: 90, linked_rules_count: 2,
      }],
      total: 1, page: 1, per_page: 20,
    });

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText("Business partner name")).toBeInTheDocument());
    expect(glossaryApi.getGlossaryTerms).toHaveBeenCalledWith({ search: "business" });
  });
});
