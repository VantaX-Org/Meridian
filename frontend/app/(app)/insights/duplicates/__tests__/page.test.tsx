// frontend/app/(app)/insights/duplicates/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import * as objectsApi from "@/lib/api/v1/objects";
import * as miningApi from "@/lib/api/mining";
import * as learnedRulesApi from "@/lib/api/learnedRules";
import { Toaster } from "@/design";
import DuplicatesPage from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const push = vi.fn();
const replace = vi.fn();
let query = "run=v1";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push, replace }),
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function explainWithMembers(members: string[]): mergeExplainApi.ExplainResponse {
  return {
    golden_record_id: members[0] ?? "000101",
    key: "000101",
    domain: "material_master",
    members,
    golden_fields: {},
    steward_overrides: {},
    survivorship: {},
    pairs: [],
    thresholds: { auto_merge: 0.95, review_floor: 0.3 },
  };
}

// Base UI ignores an option click unless the option is highlighted (hover or
// keyboard). Highlighting lands asynchronously after open, so a bare click can
// race it. Hover the option and wait for the highlight, then click: no timing
// dependence, so no inflated timeouts.
async function pickObjectAndRecord() {
  fireEvent.click(screen.getByRole("combobox"));
  const option = await screen.findByRole("option", { name: "Material master" });
  fireEvent.mouseMove(option);
  await waitFor(() => expect(option).toHaveAttribute("data-highlighted"));
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Material master"));
  fireEvent.change(screen.getByLabelText("Record ID"), { target: { value: "000101" } });
}

describe("DuplicatesPage mined tabs", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [] });
  });
  afterEach(() => { query = "run=v1"; });

  it("switches tab through the query string", async () => {
    renderWithQuery(<DuplicatesPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Anomalies" }));
    expect(replace).toHaveBeenCalledWith("?run=v1&tab=anomalies");
  });

  it("lists mined duplicate pairs with a drill to each record", async () => {
    query = "run=v1&tab=pairs";
    const get = vi.spyOn(miningApi, "getMiningDuplicates").mockResolvedValue([
      { id: "d1", version_id: "v1", module_id: "material_master", record_a: "000101", record_b: "000102", match_score: 0.97, id_field: "MATNR", matched_fields: ["MAKTX"], detected_at: "2026-10-01T00:00:00Z" },
    ]);
    renderWithQuery(<DuplicatesPage />);
    const link = await screen.findByRole("link", { name: "000101" });
    expect(link).toHaveAttribute("href", "/objects/material_master/records/000101?run=v1");
    expect(get).toHaveBeenCalledWith({ version_id: "v1", limit: 500 });
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("lists mined anomalies", async () => {
    query = "run=v1&tab=anomalies";
    vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([
      { id: "a1", version_id: "v1", module_id: "material_master", field_name: "NTGEW", field_value: 9999, record_index: 4, detection_method: "z_score", z_score: 6.2, severity: "high", detected_at: "2026-10-01T00:00:00Z" },
    ]);
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText("NTGEW")).toBeInTheDocument();
    expect(screen.getByText("6.2")).toBeInTheDocument();
  });

  it("lists mined relationships and shows an empty state when there are none", async () => {
    query = "run=v1&tab=relationships";
    const get = vi.spyOn(miningApi, "getMiningRelationships").mockResolvedValue([
      { id: "r1", version_id: "v1", module_id: "material_master", field_a: "MTART", field_b: "BKLAS", relationship_type: "dependency", strength_score: 0.9, detected_at: "2026-10-01T00:00:00Z" },
    ]);
    const view = renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText("BKLAS")).toBeInTheDocument();
    view.unmount();
    get.mockResolvedValue([]);
    const mine = vi.spyOn(learnedRulesApi, "mineLearnedRules").mockResolvedValue({ queued: true });
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText("No relationships mined")).toBeInTheDocument();
    // With a run in scope the empty state starts the miner instead of sending the reader away.
    fireEvent.click(screen.getByRole("button", { name: "Mine now" }));
    await waitFor(() => expect(mine).toHaveBeenCalledWith("v1"));
    expect(screen.queryByRole("link", { name: "Open runs" })).toBeNull();
  });
});

describe("DuplicatesPage", () => {
  it("shows an empty state before an object and record are chosen", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText(/pick an object and a record/i)).toBeInTheDocument();
  });

  it("renders the cluster graph and lets the user pick a master record", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    vi.spyOn(insightsApi, "getDuplicateCluster").mockResolvedValue({
      nodes: [
        { id: "000101", size: 1, label: "000101" },
        { id: "000102", size: 3, label: "000102" },
      ],
      edges: [{ source: "000101", target: "000102", label: "ms-1", weight: 0.97 }],
      thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue(
      explainWithMembers(["000101", "000102a", "000102b", "000102c"]),
    );
    renderWithQuery(<DuplicatesPage />);

    await pickObjectAndRecord();

    expect(await screen.findByRole("group", { name: /duplicate cluster graph/i })).toBeInTheDocument();
    const masterRadio = await screen.findByRole("radio", { name: "000101" });
    fireEvent.click(masterRadio);

    expect(await screen.findByText(/3 documents would move/i)).toBeInTheDocument();
  });

  it("creates a merge proposal for the edges touching the chosen master", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    vi.spyOn(insightsApi, "getDuplicateCluster").mockResolvedValue({
      nodes: [
        { id: "000101", size: 1, label: "000101" },
        { id: "000102", size: 3, label: "000102" },
      ],
      edges: [{ source: "000101", target: "000102", label: "ms-1", weight: 0.97 }],
      thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
    const createMergeProposals = vi
      .spyOn(insightsApi, "createMergeProposals")
      .mockResolvedValue({ created: ["mp-1"] });
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue(explainWithMembers(["000101", "000102"]));

    renderWithQuery(
      <>
        <DuplicatesPage />
        <Toaster />
      </>,
    );
    await pickObjectAndRecord();
    fireEvent.click(await screen.findByRole("radio", { name: "000101" }));

    const submit = await screen.findByRole("button", { name: /create merge proposal/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(createMergeProposals).toHaveBeenCalledWith([{ match_score_id: "ms-1", priority: 1 }]));
    expect(await screen.findByText(/created 1 merge proposal/i)).toBeInTheDocument();
    // The toast's action opens the stewardship queue in the inbox, not the retired workbench.
    fireEvent.click(await screen.findByRole("button", { name: "Review in the inbox" }));
    expect(push).toHaveBeenCalledWith("/inbox?tab=queue");
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/workbench"));
  });

  it("disables the create-merge-proposal button when no pair has a usable id", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    vi.spyOn(insightsApi, "getDuplicateCluster").mockResolvedValue({
      nodes: [
        { id: "000101", size: 1, label: "000101" },
        { id: "000102", size: 3, label: "000102" },
      ],
      edges: [{ source: "000101", target: "000102", weight: 0.97 }],
      thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue(explainWithMembers(["000101", "000102"]));

    renderWithQuery(<DuplicatesPage />);
    await pickObjectAndRecord();
    fireEvent.click(await screen.findByRole("radio", { name: "000101" }));

    expect(await screen.findByRole("button", { name: /create merge proposal/i })).toBeDisabled();
  });

  it("shows an error state when the cluster request fails", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    vi.spyOn(insightsApi, "getDuplicateCluster").mockRejectedValue(new Error("network error"));
    renderWithQuery(<DuplicatesPage />);
    await pickObjectAndRecord();
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the cluster request when the retry button is clicked", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    const getDuplicateCluster = vi
      .spyOn(insightsApi, "getDuplicateCluster")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        nodes: [{ id: "000101", size: 1, label: "000101" }],
        edges: [],
        thresholds: { auto_merge: 0.95, review_floor: 0.3 },
      });
    renderWithQuery(<DuplicatesPage />);
    await pickObjectAndRecord();

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByRole("radio", { name: "000101" })).toBeInTheDocument());
    expect(getDuplicateCluster).toHaveBeenCalledTimes(2);
  });
});
