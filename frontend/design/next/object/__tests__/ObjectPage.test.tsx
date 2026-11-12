import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import { nestRuns, RUNS_PAGE } from "../RunsTab";
import type { TabId } from "../tabs";
import { getUrl, push, setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const SYS = "ecc-production";
const MOD = "material-master";

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function open(tab: TabId, query = "") {
  setUrl(`/next/o/${SYS}/${MOD}/${tab}?fixture=1${query}`);
  return renderWithQuery(
    <ToastProvider>
      <ObjectPage system={SYS} module={MOD} tab={tab} />
    </ToastProvider>,
  );
}

describe("object page", () => {
  it("shows the object bar with the object, the system and the run's score", async () => {
    open("cycle");
    const bar = await screen.findByTestId("object-bar");
    expect(within(bar).getByText(/ECC production/)).toBeTruthy();
    await waitFor(() => expect(within(bar).getByTestId("object-dqs").textContent).toMatch(/\d/));
  });

  it("opens a tab as a path segment and keeps the run", async () => {
    open("cycle", "&run=abc");
    await screen.findByTestId("object-page");
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    expect(push).toHaveBeenCalled();
    expect(getUrl()).toMatch(/\/next\/o\/ecc-production\/material-master\/runs\?.*run=abc/);
  });

  it("says so when the system in the address does not exist", async () => {
    setUrl(`/next/o/nowhere/${MOD}/cycle?fixture=1`);
    renderWithQuery(<ToastProvider><ObjectPage system="nowhere" module={MOD} tab="cycle" /></ToastProvider>);
    expect(await screen.findByText("No system called nowhere")).toBeTruthy();
  });
});

describe("cycle tab", () => {
  it("lists the five steps and opens the step in the address", async () => {
    open("cycle", "&step=clean");
    await screen.findByTestId("cycle-tab");
    expect(await screen.findByTestId("clean-step")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Steps of the cleaning cycle" })).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "Download and clean" })).toBeTruthy();
  });

  it("the compare step shows the score change and the new, resolved and regressed counts", async () => {
    open("cycle", "&step=compare");
    expect(await screen.findByTestId("compare-step")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("compare-receipt").textContent).toMatch(/new.*resolved.*regressed/));
  });

  it("the upload step holds the upload back until a workbook is added", async () => {
    open("cycle", "&step=upload");
    expect(await screen.findByTestId("upload-step")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Upload and score/ }) as HTMLButtonElement).getAttribute("aria-disabled") ?? String((screen.getByRole("button", { name: /Upload and score/ }) as HTMLButtonElement).disabled)).toBe("true");
  });
});

describe("runs tab", () => {
  it("pages the runs fifty at a time", async () => {
    open("runs");
    const range = await screen.findByTestId("runs-range");
    await waitFor(() => expect(range.textContent).toMatch(/1.*50.*500/));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByTestId("runs-range").textContent).toMatch(/51.*100/));
  });

  it("compares any two runs picked in the table", async () => {
    open("runs");
    await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /^Select Run / }).length).toBeGreaterThan(1));
    const boxes = screen.getAllByRole("checkbox", { name: /^Select Run / });
    fireEvent.click(boxes[0]);
    fireEvent.click(boxes[3]);
    fireEvent.click(screen.getByRole("button", { name: "Compare these two" }));
    expect(getUrl()).toMatch(/\/cycle\?.*step=compare.*before=.*after=/);
  });

  it("nests a cleaned run under the run it was cleaned from, and Flat lays them out in order", () => {
    const h = (id: string, parent: string | null) => ({ id, parent_version_id: parent }) as never;
    const rows = [h("c", "a"), h("b", null), h("a", null)];
    expect(nestRuns(rows, false).map((r) => [r.h.id, r.depth])).toEqual([["b", 0], ["a", 0], ["c", 1]]);
    expect(nestRuns(rows, true).map((r) => r.h.id)).toEqual(["c", "b", "a"]);
    expect(RUNS_PAGE).toBe(50);
  });
});
