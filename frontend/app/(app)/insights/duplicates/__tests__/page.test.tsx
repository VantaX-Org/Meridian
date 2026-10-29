// frontend/app/(app)/insights/duplicates/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import * as objectsApi from "@/lib/api/v1/objects";
import * as miningApi from "@/lib/api/mining";
import * as learnedRulesApi from "@/lib/api/learnedRules";
import * as versionsApi from "@/lib/api/versions";
import { Toaster } from "@/design";
import DuplicatesPage from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const push = vi.fn();
const replace = vi.fn();
let query = "run=v1";
let pathname = "/insights";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
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
  fireEvent.click(screen.getByRole("combobox", { name: "Object" }));
  const option = await screen.findByRole("option", { name: "Material master" });
  fireEvent.mouseMove(option);
  await waitFor(() => expect(option).toHaveAttribute("data-highlighted"));
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Object" })).toHaveTextContent("Material master"));
  fireEvent.change(screen.getByLabelText("Record key"), { target: { value: "000101" } });
}

describe("DuplicatesPage mined tabs", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [] });
  });
  afterEach(() => { query = "run=v1"; });

  it("is one flow under the page's own tabs: no second tab strip", async () => {
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByRole("region", { name: "Likely duplicates" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Anomalies" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Relationships" })).toBeInTheDocument();
    for (const name of ["Clusters", "Likely duplicates", "Anomalies", "Relationships"]) {
      expect(screen.queryByRole("tab", { name })).not.toBeInTheDocument();
    }
  });

  it("sends a mined pair's review to Match review with the pair selected", async () => {
    vi.spyOn(miningApi, "getMiningDuplicates").mockResolvedValue([
      { id: "d1", version_id: "v1", module_id: "material_master", record_a: "000101", record_b: "000102", match_score: 0.97, id_field: "MATNR", matched_fields: ["MAKTX"], detected_at: "2026-10-01T00:00:00Z" },
    ]);
    renderWithQuery(<DuplicatesPage />);
    const review = await screen.findByRole("link", { name: "Review 000101 and 000102 in Match review" });
    expect(review).toHaveAttribute("href", "/mdm/golden/merge?object=material_master&record=000101&with=000102");
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
    expect(screen.getByText("z 6.2")).toBeInTheDocument();
    // mined before the key was kept: named by its row, opening the object's fields
    expect(screen.getByText("Record 5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Material master fields" })).toHaveAttribute("href", "/objects/material_master?run=v1&tab=fields");
  });

  it("names each anomaly's record in Mono with its value and usual range, and opens the record", async () => {
    query = "run=v1&tab=anomalies";
    const row = (id: string, key: string, value: number) => ({
      id, version_id: "v1", module_id: "hcm", field_name: "PA0007.EMPCT", field_value: value, record_index: 3, record_key: key,
      detection_method: "iqr", z_score: null, lower_bound: 40, upper_bound: 100, severity: "high" as const, detected_at: "2026-10-01T00:00:00Z",
    });
    vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([row("a1", "PERNR=00001001|SUBTY=0001", 400), row("a2", "PERNR=00001002|SUBTY=0001", 380)]);
    renderWithQuery(<DuplicatesPage />);
    const key = await screen.findByText("PERNR=00001001|SUBTY=0001");
    expect(key.closest("a")).toHaveAttribute("href", "/objects/hcm/records/PERNR%3D00001001%7CSUBTY%3D0001?run=v1");
    expect(screen.getByText("PERNR=00001002|SUBTY=0001")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getAllByText("usual 40 to 100")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open record PERNR=00001002|SUBTY=0001" })).toHaveAttribute("href", "/objects/hcm/records/PERNR%3D00001002%7CSUBTY%3D0001?run=v1");
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
    const houseRules = vi.spyOn(learnedRulesApi, "mineLearnedRules").mockResolvedValue({ queued: true });
    const mine = vi.spyOn(miningApi, "runMining").mockResolvedValue({ task_id: "t1", version_id: "v1", include: ["relationship"] });
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText("No field relationships found yet")).toBeInTheDocument();
    // With a run in scope the empty state starts the miner that fills this feed, not the learned-rules miner.
    fireEvent.click(screen.getByRole("button", { name: "Search now" }));
    await waitFor(() => expect(mine).toHaveBeenCalledWith("v1", ["relationship"]));
    expect(houseRules).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Open runs" })).toBeNull();
  });
});

const summary = (score: number) => ({ composite_score: score, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0 });

describe("DuplicatesPage in the current state", () => {
  afterEach(() => { query = "run=v1"; pathname = "/insights"; });

  it("opens on the current state without ?run=: every object's own latest run, and one empty state when nothing is mined", async () => {
    query = "";
    pathname = "/insights/duplicates";
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [
      { id: "co", label: "controlling_1k", status: "complete", run_at: "2026-10-16T05:00:00Z", dqs_summary: { controlling: summary(70) } },
      { id: "mm", label: "material_master_25k", status: "complete", run_at: "2026-10-16T03:00:00Z", dqs_summary: { material_master: summary(70) } },
    ] as never });
    const objects = vi.spyOn(objectsApi, "getObjects");
    const dup = vi.spyOn(miningApi, "getMiningDuplicates").mockResolvedValue([]);
    const anom = vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([]);
    const rel = vi.spyOn(miningApi, "getMiningRelationships").mockResolvedValue([]);
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText("Nothing found yet")).toBeInTheDocument();
    for (const get of [dup, anom, rel]) expect(get).toHaveBeenCalledWith({ scope: "current", limit: 500 });
    // One empty state for the page, not one for the cluster and one per mined feed.
    expect(screen.queryByText(/choose an object and a record/i)).toBeNull();
    expect(screen.queryByRole("region", { name: "Likely duplicates" })).toBeNull();
    expect(screen.queryByText("No likely duplicates found yet")).toBeNull();
    // The record lookup offers every object of the current state, not only the newest run's.
    expect(objects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "Object" }));
    expect(await screen.findByRole("option", { name: "Material master" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Controlling" })).toBeInTheDocument();
  });
});

describe("DuplicatesPage", () => {
  it("shows one empty state before a record is chosen when the run has nothing mined", async () => {
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [{ module: "material_master", label: "Material master", composite_score: 72, readiness: "fail", failing_checks: 3, affected_records: 2 }],
    });
    vi.spyOn(miningApi, "getMiningDuplicates").mockResolvedValue([]);
    vi.spyOn(miningApi, "getMiningAnomalies").mockResolvedValue([]);
    vi.spyOn(miningApi, "getMiningRelationships").mockResolvedValue([]);
    renderWithQuery(<DuplicatesPage />);
    expect(await screen.findByText("Nothing found in this run yet")).toBeInTheDocument();
    expect(screen.queryByText("No anomalies found yet")).toBeNull();
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

    expect(await screen.findByText(/3 linked documents would move/i)).toBeInTheDocument();
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
    expect(push).toHaveBeenCalledWith("/inbox");
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining("/workbench"));
  });

  it("says so when the merge proposal fails, instead of failing silently", async () => {
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
    vi.spyOn(insightsApi, "createMergeProposals").mockRejectedValue(new Error("merge service unavailable"));
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue(explainWithMembers(["000101", "000102"]));
    renderWithQuery(<><DuplicatesPage /><Toaster /></>);
    await pickObjectAndRecord();
    fireEvent.click(await screen.findByRole("radio", { name: "000101" }));
    fireEvent.click(await screen.findByRole("button", { name: /create merge proposal/i }));
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /create merge proposal/i })).not.toBeDisabled();
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
