// frontend/app/(app)/search/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import * as connectivityApi from "@/lib/api/connectivity";
import * as remediationApi from "@/lib/api/remediation";
import * as objectsApi from "@/lib/api/v1/objects";
import * as versionsApi from "@/lib/api/versions";
import * as glossaryApi from "@/lib/api/glossary";
import * as processApi from "@/lib/api/process-discovery";
import * as designerApi from "@/lib/api/process-designer";
import type { SAPSystemExtended } from "@/types/api";
import SearchPage from "../page";

let params = "q=business";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true, role: "admin" }) }));

const emptyRules = { rules: [], total: 0, limit: 100, offset: 0 };

describe("SearchPage", () => {
  beforeEach(() => {
    vi.spyOn(glossaryApi, "getGlossaryTerms").mockResolvedValue({ terms: [], total: 0, page: 1, per_page: 20 });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    vi.spyOn(remediationApi, "listBatches").mockResolvedValue({ items: [] });
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "", objects: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(designerApi, "listModels").mockResolvedValue([]);
    vi.spyOn(processApi, "getCatalogue").mockResolvedValue([]);
    vi.spyOn(processApi, "listRuns").mockResolvedValue([]);
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

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText("Business partner VAT check")).toBeInTheDocument());
  });

  it("shows an empty state when nothing matches", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue(emptyRules);

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText(/no results for "business"/i)).toBeInTheDocument());
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(rulesApi, "getRules").mockRejectedValue(new Error("rules service unavailable"));

    renderWithQuery(<SearchPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (rulesApi.getRules as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((rulesApi.getRules as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it("finds glossary terms", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue(emptyRules);
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

  it("indexes systems as System, named batches, L1 processes, discovery runs, process models and nav pages", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue(emptyRules);
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s1", name: "Business ECC", health_status: "healthy" } as SAPSystemExtended]);
    vi.spyOn(remediationApi, "listBatches").mockResolvedValue({ items: [{
      id: "b1", name: "Business partner VAT fixes", status: "draft", filter: {}, created_by: null, created_by_label: null,
      created_at: "2026-10-10T00:00:00Z", approved_by: null, approved_by_label: null, approved_at: null, exported_at: null,
      items: 3, with_proposal: 3, auto_approvable: 1, fixed: 0, still_failing: 0,
    } as remediationApi.BatchSummary] });
    vi.spyOn(processApi, "getCatalogue").mockResolvedValue([{
      l1: "PTP", name: "Business procure to pay", coverage: "discovered", reason: null, last_run: null, in_progress: null, failed: null, sources: [],
    }]);
    vi.spyOn(processApi, "listRuns").mockResolvedValue([{
      id: "pr1", l1: "PTP", mode: "full", status: "completed", coverage: "discovered", window_from: null, window_to: null, watermark: null,
      extraction_version_id: null, job_id: null, filters: {}, stats: {}, error: null, started_at: "2026-10-12T09:00:00Z", finished_at: null,
    }]);
    vi.spyOn(designerApi, "listModels").mockResolvedValue([{ id: "m1", name: "Business target model", status: "draft", current_version: 1, updated_at: null }]);

    renderWithQuery(<SearchPage />);
    await waitFor(() => expect(screen.getByText("Business ECC")).toBeInTheDocument());
    expect(screen.getByText("System")).toBeInTheDocument();
    expect(screen.queryByText(/^Batch b1/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open Business partner VAT fixes" })).toHaveAttribute("href", "/fix?tab=batches&batch=b1");
    expect(screen.getByRole("link", { name: "Open Business procure to pay" })).toHaveAttribute("href", "/process/PTP?system=s1");
    expect(screen.getByRole("link", { name: "Open Business procure to pay, 12 Oct 2026" })).toHaveAttribute("href", "/process/runs/pr1");
    expect(screen.getByRole("link", { name: "Open Business target model" })).toHaveAttribute("href", "/insights/process/designer?model=m1");
    expect(screen.getByText("Process model")).toBeInTheDocument();
    expect(processApi.listRuns).toHaveBeenCalledWith("s1", { limit: 50 });
  });
});

describe("SearchPage pages", () => {
  it("indexes the nav pages the viewer may see, with the home resolved for their persona", async () => {
    params = "q=home";
    vi.spyOn(rulesApi, "getRules").mockResolvedValue(emptyRules);
    renderWithQuery(<SearchPage />);
    expect(await screen.findByRole("link", { name: "Open Home" })).toHaveAttribute("href", "/home/lead");
    expect(screen.getByText("Page")).toBeInTheDocument();
    params = "q=business";
  });
});
