import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { SheetHost } from "@/design/next/shell/SheetHost";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { useObjectRun } from "../../useObjectRun";
import { CompareStep } from "../CompareStep";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const keysCalls: { search?: string; change: string }[] = [];
const page = { v1: "a", v2: "b", records: [{ check_id: "MM-X-1", record_key: "MATNR=42", module: "material_master", change: "new", reason: null, values_before: null, values_after: null }], total: 1, limit: 50, offset: 0, next_offset: null };

vi.mock("@/lib/api/next/runs", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/next/runs")>()),
  useCompareSets: () => ({ data: page, isLoading: false, error: null, refetch: () => undefined }),
}));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({
  ...(await orig<typeof import("@/lib/v2/runs-queries")>()),
  useVersionChanges: () => ({ data: { checks: { changed: [{ check_id: "MM-X-1", message: "The threshold moved from 5 to 10." }] } } }),
  useCompareRecords: () => ({ isPending: false, isError: false, data: { checks: [{ check_id: "MM-X-1", new: 2, resolved: 0, persisting: 0 }] } }),
  useCompareRecordKeys: (_id: string, q: { search?: string; change: string }) => {
    keysCalls.push(q);
    const all = ["MATNR=42", "MATNR=77"];
    return { isPending: false, isError: false, isSuccess: true, data: { record_keys: q.search ? all.filter((k) => k.includes(q.search as string)) : all } };
  },
}));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  keysCalls.length = 0;
});

function Harness() {
  const o = useObjectRun("ecc-production", "material-master");
  return <CompareStep o={o} cycle={1} onNextCycle={() => undefined} />;
}

function open() {
  setUrl("/next/o/ecc-production/material-master/cycle?fixture=1");
  return renderWithQuery(<ToastProvider><SheetHost><Harness /></SheetHost></ToastProvider>);
}

describe("compare step parity with v2", () => {
  it("shows the version-change message beside the rule", async () => {
    open();
    const msg = await screen.findByTestId("change-message");
    expect(msg.textContent).toMatch(/threshold moved from 5 to 10/);
  });

  it("searches the record keys of the picked rule", async () => {
    open();
    await screen.findByTestId("record-search-section");
    expect((await screen.findByTestId("record-keys")).textContent).toMatch(/MATNR=77/);
    fireEvent.change(screen.getByTestId("record-search"), { target: { value: "42" } });
    await waitFor(() => expect(screen.getByTestId("record-keys").textContent).not.toMatch(/MATNR=77/));
    expect(keysCalls.some((q) => q.search === "42")).toBe(true);
    fireEvent.change(screen.getByTestId("record-search"), { target: { value: "999" } });
    expect((await screen.findByTestId("record-search-empty")).textContent).toMatch(/No record key matches/);
  });
});
