import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { RunAdmin } from "../RunAdmin";
import type { VersionHead } from "@/lib/api/v2/runs";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: false, viewAs: null, shared: false }) }));

const A = vi.hoisted(() => ({
  pinBaseline: vi.fn(async (id: string, pinned: boolean) => ({ version_id: id, baseline: pinned })),
  archiveRuns: vi.fn(async () => ({ archived: 1 })),
  restoreRuns: vi.fn(async () => ({ restored: 1 })),
  splitScope: vi.fn(async (_s: string, _v: string, start: boolean) => ({
    split_by: "dates",
    tables: ["MARA"],
    scopes: [{ date_from: "2026-01-01", date_to: "2026-03-31" }, { date_from: "2026-04-01", date_to: "2026-06-30" }],
    downloads: start ? [{ job_id: "j1", version_id: "v1" }, { job_id: "j2", version_id: "v2" }] : undefined,
  })),
}));
vi.mock("@/lib/api/v2/runs", async (orig) => ({ ...(await orig<object>()), ...A }));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({ ...(await orig<object>()), useVersionsPage: () => ({ data: { versions: [{ id: "r2" }, { id: "r1" }], total: 2 } }) }));

const head = {
  id: "r2",
  run_at: "2026-11-01T00:00:00Z",
  status: "complete",
  metadata: { system_id: "sys1", truncated_tables: ["MARA"], coverage: [{ table: "MARA", status: "truncated", rows: 1000, source_rows: 5000, truncated: true }] },
} as unknown as VersionHead;

beforeEach(() => {
  setUrl("/next/run/r2");
  window.sessionStorage.removeItem("mn_v2_fixture");
  Object.values(A).forEach((f) => f.mockClear());
});

describe("Run admin (next)", () => {
  it("pins the baseline and archives the older run", async () => {
    renderWithQuery(<ToastProvider><RunAdmin head={head} old={false} /></ToastProvider>);
    expect(screen.getByTestId("run-capped").textContent).toContain("MARA");
    fireEvent.click(screen.getByTestId("run-pin"));
    await waitFor(() => expect(A.pinBaseline).toHaveBeenCalledWith("r2", true));
    await waitFor(() => expect((screen.getByTestId("run-archive") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("run-archive").textContent).toContain("Archive the 1 older run");
    fireEvent.click(screen.getByTestId("run-archive"));
    await waitFor(() => expect(A.archiveRuns).toHaveBeenCalledWith(1));
  });

  it("previews a split scope, then starts the downloads", async () => {
    renderWithQuery(<ToastProvider><RunAdmin head={head} old={false} /></ToastProvider>);
    fireEvent.click(screen.getByTestId("run-split"));
    await waitFor(() => expect(screen.getByTestId("run-split-preview")).toBeTruthy());
    expect(screen.getByText("2026-01-01 to 2026-03-31")).toBeTruthy();
    fireEvent.click(screen.getByTestId("run-split-start"));
    await waitFor(() => expect(A.splitScope).toHaveBeenLastCalledWith("sys1", "r2", true));
    await waitFor(() => expect(screen.queryByTestId("run-split-preview")).toBeNull());
  });
});
