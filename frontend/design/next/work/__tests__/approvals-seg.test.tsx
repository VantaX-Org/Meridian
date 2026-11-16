import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { WorkApprovals, changed, weekly, worstVerdict } from "../Cleansing";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});
const fx = (u: string) => {
  window.history.pushState({}, "", u);
  setUrl(u);
};
const page = () =>
  renderWithQuery(
    <ToastProvider>
      <WorkApprovals />
    </ToastProvider>,
  );

describe("Work approvals segment", () => {
  it("renders the batches waiting and the cleaning review", async () => {
    fx("/next/work/approvals");
    page();
    expect(screen.getByRole("radiogroup", { name: "Approvals" })).toBeInTheDocument();
    expect(await screen.findByTestId("approvals-batch-open-B-241")).toBeInTheDocument();
    expect(await screen.findByTestId("cleansing")).toBeInTheDocument();
  });

  it("opens a batch in a sheet", async () => {
    fx("/next/work/approvals");
    page();
    await userEvent.click(await screen.findByTestId("approvals-batch-open-B-241"));
    expect(await screen.findByTestId("sheet")).toBeInTheDocument();
  });

  it("reassigns a whole batch", async () => {
    fx("/next/work/approvals");
    page();
    await userEvent.click(await screen.findByTestId("approvals-batch-reassign-B-241"));
    await screen.findByTestId("approvals-batch-reassign-to-B-241");
    await waitFor(() => expect(screen.getByTestId("approvals-batch-reassign-go-B-241")).toBeEnabled());
    await userEvent.click(screen.getByTestId("approvals-batch-reassign-go-B-241"));
    expect(await screen.findByText(/reassigned/)).toBeInTheDocument();
  });

  it("hides approve and reassign from a viewer", async () => {
    fx("/next/work/approvals?role=viewer");
    page();
    expect(await screen.findByTestId("approvals-batch-open-B-241")).toBeInTheDocument();
    await screen.findByTestId("cleansing-group-MEINS");
    expect(screen.queryByTestId("cleansing-approve-group-MEINS")).toBeNull();
    expect(screen.queryByTestId("approvals-batch-reassign-B-241")).toBeNull();
  });
});

describe("helpers", () => {
  it("sums weekly snapshots oldest first", () => {
    const m = (period: string, object_type: string, detected: number) => ({
      period, period_type: "week", object_type, detected, recommended: 0, approved: 0, rejected: 0, applied: 0, verified: 0, rolled_back: 0, auto_approved: 0,
    });
    const w = weekly([m("2026-W02", "material", 3), m("2026-W01", "material", 1), m("2026-W02", "customer", 2)] as never);
    expect(w.map((x) => x.period)).toEqual(["2026-W01", "2026-W02"]);
    expect(w[1].sums.detected).toBe(5);
  });

  it("lists only changed fields", () => {
    expect(changed({ MEINS: "EA", MATKL: "01" }, { MEINS: "PC", MATKL: "01" })).toEqual([{ field: "MEINS", from: "EA", to: "PC" }]);
  });

  it("returns the worst verdict", () => {
    const items = [{ id: "a", verdict: "safe" }, { id: "a", verdict: "reject" }, { id: "b", verdict: "unknown" }] as never;
    expect(worstVerdict(items, "a")).toBe("reject");
    expect(worstVerdict(items, "b")).toBe("unknown");
    expect(worstVerdict(items, "c")).toBeNull();
  });
});
