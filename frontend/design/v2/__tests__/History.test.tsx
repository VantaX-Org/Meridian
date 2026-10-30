import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureResponse, resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as workApi from "@/lib/api/v2/work";
import type { RecordHistory } from "@/lib/api/v2/step10";
import type { WorkPage } from "@/lib/api/v2/types";
import { eventWords } from "@/lib/v2/step10";
import { resetActions } from "@/lib/v2/undo";
import { readState } from "@/lib/v2/work";
import { clearPatches } from "@/lib/v2/work-overrides";
import { Inspector } from "../Inspector";
import { ToastProvider } from "../Toast";
import { RunTimelineMenu } from "../RunTimeline";
import { ObjectFrame, RulesTab } from "../screens/Object";
import { WorkCanvas } from "../screens/Work";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const KEY = "000000000000000100";
const R6 = "b0600000-0000-4000-8000-000000000006";
const R3 = "b0300000-0000-4000-8000-000000000003";

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  resetWorkFixture();
  resetActions();
  clearPatches();
  undo = stubLayout(1400, 600);
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("record history", () => {
  it("the History tab lists every run's values of the failing field and the decisions in order, with who, when and the run", async () => {
    setUrl(`/work?fixture=1&open=${encodeURIComponent(`record:material_master:MATNR=${KEY}`)}`);
    renderWithQuery(
      <ToastProvider>
        <Inspector />
      </ToastProvider>,
    );
    const tabs = await screen.findByRole("tablist", { name: "Views of this record" });
    expect(within(tabs).getByRole("tab", { name: "Record" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(within(tabs).getByRole("tab", { name: "History" }));
    const panel = await screen.findByTestId("record-history-tab");
    const table = await within(panel).findByTestId("history-runs");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(9); // the header and 8 runs, newest first
    expect(within(table).getByRole("columnheader", { name: "MARA.MEINS" })).toBeInTheDocument();
    expect(norm(rows[1])).toContain("16 Oct 2026");
    expect(norm(rows[1])).toContain("Failing");
    expect(norm(rows[8])).toContain("Passing");
    expect(within(rows[1]).getByRole("link", { name: /16 Oct 2026/ })).toHaveAttribute("href", "/run/d3229ded-0708-4967-9dfb-1b7f4fada953?fixture=1");
    const events = within(panel).getByTestId("history-events");
    expect(norm(events)).toContain("MM014: started failing");
    expect(norm(events)).toContain("MM014: assigned to A. Naidoo");
    expect(norm(events)).toContain("R. Govender");
    expect(within(events).getAllByRole("link", { name: "open the run" }).length).toBeGreaterThan(0);
  });

  it("names each kind of event in words", () => {
    const base = { at: null, check_id: "MM014", run_id: null, scope: null, from_value: null, note: null, by: null, batch_id: null, batch_status: null };
    expect(eventWords({ ...base, kind: "fix_proposed", action: "proposed", to_value: "EA" })).toBe("MM014: fix proposed to EA");
    expect(eventWords({ ...base, kind: "fix_sent", action: null, to_value: null })).toBe("MM014: fix sent to SAP");
    expect(eventWords({ ...base, kind: "issue", action: "comment", to_value: null, note: "Checked with the plant" })).toBe("MM014: comment: Checked with the plant");
  });

  it("the history read keeps the oldest run first, as the API does", () => {
    const h = fixtureResponse<RecordHistory>(`/work/records/material_master/MATNR=${KEY}/history`, {});
    expect(h.runs[0].run_at < h.runs[h.runs.length - 1].run_at).toBe(true);
    expect(h.systems).toEqual(["a1b2c3d4-0001-4000-8000-000000000001"]);
  });
});

describe("the Work ledger as of a run", () => {
  it("reads as_of_run from the address, never with scope=current, and says the ledger is historical", async () => {
    const spy = vi.spyOn(workApi, "getWork");
    expect(readState(new URLSearchParams(`as_of_run=${R6}`)).asOf).toBe(R6);
    setUrl(`/work?fixture=1&as_of_run=${R6}&filter=open`);
    renderWithQuery(
      <ToastProvider>
        <WorkCanvas />
      </ToastProvider>,
    );
    const band = await screen.findByTestId("ledger-as-of");
    await waitFor(() => expect(norm(band)).toContain("As it stood at run 9 Oct 2026, 05:13; statuses are today's."));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ as_of_run: R6 });
    const today = fixtureResponse<WorkPage>("/work/records", { scope: "current", status: "open", limit: 500 });
    const then = fixtureResponse<WorkPage>("/work/records", { as_of_run: R3, status: "open", limit: 500 });
    expect(then.total).toBeLessThan(today.total);
    expect(() => fixtureResponse("/work/records", { as_of_run: R3, scope: "current" })).toThrow(/exclusive/);
    expect(screen.getByRole("button", { name: /Export fix sheet/ })).toBeDisabled();
    fireEvent.click(within(band).getByRole("button", { name: "Back to today" }));
    await waitFor(() => expect(getUrl()).not.toContain("as_of_run"));
  });

  it("the As of run picker writes the run into the address", async () => {
    setUrl("/work?fixture=1");
    renderWithQuery(
      <ToastProvider>
        <WorkCanvas />
      </ToastProvider>,
    );
    const pick = await screen.findByTestId("as-of-run");
    await waitFor(() => expect(within(pick).getAllByRole("option").length).toBeGreaterThan(2));
    fireEvent.change(pick, { target: { value: R3 } });
    await waitFor(() => expect(getUrl()).toContain(`as_of_run=${R3}`));
  });
});

describe("the Object canvas as of a run", () => {
  it("shows the object as it stood with its band, ruler and rules, and goes back to today", async () => {
    setUrl(`/o/ecc-production/material-master?fixture=1&as_of=${R3}`);
    renderWithQuery(
      <ObjectFrame system="ecc-production" module="material-master">
        <RulesTab system="ecc-production" module="material-master" />
      </ObjectFrame>,
    );
    const band = await screen.findByTestId("as-of-band");
    await waitFor(() => expect(norm(band)).toContain("As it stood at the run of 18 Sept 2026, 05:16."));
    const rules = await screen.findByTestId("as-of-rules");
    expect(norm(rules)).toContain("MM014");
    expect(screen.queryByTestId("receipt")).toBeNull();
    expect(within(band).getByRole("link", { name: "Back to today" })).toHaveAttribute("href", expect.not.stringContaining("as_of"));
  });

  it("the run menu on an object offers As of", async () => {
    setUrl("/o/ecc-production/material-master?fixture=1");
    renderWithQuery(<RunTimelineMenu />);
    fireEvent.click(await screen.findByRole("button", { name: /^Run / }));
    const picker = await screen.findByTestId("as-of-picker");
    fireEvent.change(within(picker).getByLabelText("As of"), { target: { value: R3 } });
    fireEvent.click(within(picker).getByRole("button", { name: "Show the object as it stood" }));
    await waitFor(() => expect(getUrl()).toContain(`as_of=${R3}`));
  });
});
