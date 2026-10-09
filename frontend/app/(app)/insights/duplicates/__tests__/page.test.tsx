// frontend/app/(app)/insights/duplicates/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import * as objectsApi from "@/lib/api/v1/objects";
import { ToastViewport } from "@/design";
import DuplicatesPage from "../page";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push }),
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

async function pickObjectAndRecord() {
  fireEvent.click(screen.getByRole("combobox"));
  const option = await screen.findByRole("option", { name: "Material master" });
  await waitFor(() => expect(option.closest("[role=listbox]")).toHaveAttribute("data-open"));
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("Material master"));
  fireEvent.change(screen.getByLabelText("Record ID"), { target: { value: "000101" } });
}

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

    expect(await screen.findByRole("img", { name: /duplicate cluster graph/i })).toBeInTheDocument();
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
        <ToastViewport />
      </>,
    );
    await pickObjectAndRecord();
    fireEvent.click(await screen.findByRole("radio", { name: "000101" }));

    const submit = await screen.findByRole("button", { name: /create merge proposal/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(createMergeProposals).toHaveBeenCalledWith([{ match_score_id: "ms-1", priority: 1 }]));
    expect(await screen.findByText(/created 1 merge proposal/i)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText(/network error/i)).toBeInTheDocument());
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
