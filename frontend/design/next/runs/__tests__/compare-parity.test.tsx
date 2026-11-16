import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { CompareMatrix } from "../CompareSheet";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const R = vi.hoisted(() => ({
  retry: vi.fn(),
  state: { heads: [] as unknown[], loading: false, error: null as unknown },
}));
vi.mock("@/lib/api/next/runs", async (orig) => ({ ...(await orig<object>()), useRuns: () => ({ ...R.state, retry: R.retry }) }));

const ok = <T,>(data: T) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
vi.mock("@/lib/v2/runs-queries", async (orig) => ({
  ...(await orig<object>()),
  useCompareSummary: () => ok({
    method: "Scores are raw composite scores.",
    objects: [{ module: "material_master", label: "Material master", before: { raw_score: 70, score: 70, records_checked: 100, coverage: 1 }, after: { raw_score: 75, score: 75, records_checked: 100, coverage: 1 }, newly_failing: 1, fixed: 2, worse: 0, better: 1 }],
    totals: { newly_failing: 1, fixed: 2, worse: 0, better: 1 },
  }),
  useVersionChanges: () => ok({ checks: { newly_failing: [{ check_id: "MM_001", module: "material_master", message: "Base unit is filled", v1_affected: 0, v2_affected: 3 }], fixed: [], worse: [], better: [] } }),
  useCompareRecords: () => ok({ totals: { new: 3, resolved: 2, persisting: 1 }, checks: [{ check_id: "MM_001", module: "material_master", comparable: true, new: 3, resolved: 2, persisting: 1 }] }),
  useCompareRecordKeys: () => ok({ record_keys: ["MAT-1", "MAT-2", "MAT-3"] }),
}));

const run = (id: string, at: string) => ({ id, run_at: at, status: "complete", dqs_summary: { material_master: { composite_score: 70 } } });

beforeEach(() => {
  setUrl("/next/run/a/vs/b");
  window.sessionStorage.removeItem("mn_v2_fixture");
  R.retry.mockClear();
  R.state = { heads: [run("a", "2026-11-01T00:00:00Z"), run("b", "2026-11-02T00:00:00Z")], loading: false, error: null };
});

describe("Compare two runs (next)", () => {
  it("shows the scores, the rules that changed, and the records per rule", async () => {
    renderWithQuery(<ToastProvider><CompareMatrix ids={["a", "b"]} /></ToastProvider>);
    expect(screen.getByTestId("compare-pair")).toBeTruthy();
    expect(screen.getAllByTestId("compare-row")).toHaveLength(1);
    expect(screen.getByTestId("what-changed").textContent).toContain("MM_001");
    fireEvent.click(screen.getByRole("radio", { name: "Records" }));
    await waitFor(() => expect(screen.getByTestId("compare-records-totals").textContent).toContain("3 newly failing"));
    fireEvent.click(screen.getByRole("button", { name: "See records" }));
    await waitFor(() => expect(screen.getByTestId("compare-record-keys").textContent).toContain("MAT-2"));
  });

  it("offers a retry when the runs cannot be read", () => {
    R.state = { heads: [], loading: false, error: new Error("boom") };
    renderWithQuery(<ToastProvider><CompareMatrix ids={["a", "b"]} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Try again|Retry/ }));
    expect(R.retry).toHaveBeenCalled();
  });
});
