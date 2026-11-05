import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { resetLearnedMonitors } from "@/lib/api/v2/fixtures/learnedMonitors";
import { renderWithQuery } from "@/__tests__/render";
import { LearnedMonitors } from "../screens/LearnedMonitors";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  resetLearnedMonitors();
  setUrl("/monitors");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("learned monitors", () => {
  it("shows an object still learning with a dash for breaks, and a watched one with its count", async () => {
    renderWithQuery(<LearnedMonitors />);
    const learning = await screen.findByTestId("monitor-object-sd_customer_master");
    expect(within(learning).getByText("Learning")).toBeInTheDocument();
    expect(within(learning).getByText("3 of 5 needed")).toBeInTheDocument();
    const watched = screen.getByTestId("monitor-object-material_master");
    expect(within(watched).getByText("Watching")).toBeInTheDocument();
  });

  it("lists each break with its rule or field code beside the description", async () => {
    renderWithQuery(<LearnedMonitors />);
    const row = await screen.findByTestId("break-lm-2");
    expect(within(row).getByText("MM014")).toBeInTheDocument();
    expect(within(row).getByText("Base unit not valid")).toBeInTheDocument();
    expect(within(screen.getByTestId("break-lm-1")).getByText("MARA-BRGEW")).toBeInTheDocument();
  });

  it("explains a break and cites the runs behind it, with no actions for a viewer", async () => {
    const u = "/monitors?fixture=1&persona=steward&role=viewer"; window.history.pushState({}, "", u); setUrl(u);
    renderWithQuery(<LearnedMonitors />);
    fireEvent.click(within(await screen.findByTestId("break-lm-2")).getByRole("button", { name: "Fail rate jump" }));
    expect(await screen.findByTestId("monitors-explanation")).toHaveTextContent("Base unit not valid (MM014)");
    expect(screen.getByTestId("monitors-cites")).toHaveTextContent("Run 12 (this run)");
    expect(screen.queryByTestId("monitors-actions")).toBeNull();
  });

  it("shows a volume break found between full runs, and its detail says it came before the analysis finished", async () => {
    renderWithQuery(<LearnedMonitors />);
    const row = await screen.findByTestId("interim-lm-i1");
    expect(within(row).getByText("SD customer master")).toBeInTheDocument();
    expect(within(row).getByText("4,100")).toBeInTheDocument();
    expect(within(row).getByText("Analysis pending")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Volume drop" }));
    expect(await screen.findByTestId("monitors-explanation")).toHaveTextContent("Found between full runs");
  });
});

describe("value pattern and range breaks", () => {
  it("shows the field code beside its description and the share for a pattern or format break", async () => {
    renderWithQuery(<LearnedMonitors />);
    const pat = await screen.findByTestId("break-lm-6");
    expect(within(pat).getByRole("button", { name: "Value shapes shifted" })).toBeInTheDocument();
    expect(within(pat).getByText("MARA-MTART")).toBeInTheDocument();
    expect(within(pat).getByText("Material type")).toBeInTheDocument();
    expect(within(pat).getByText("31.5%")).toBeInTheDocument();
    const fmtb = screen.getByTestId("break-lm-7");
    expect(within(fmtb).getByRole("button", { name: "Format broke" })).toBeInTheDocument();
    expect(within(fmtb).getByText("22.4%")).toBeInTheDocument();
  });

  it("shows only how far a range moved, never the mean or the dates themselves", async () => {
    renderWithQuery(<LearnedMonitors />);
    const mean = await screen.findByTestId("break-lm-8");
    expect(within(mean).getByRole("button", { name: /Range shifted/ })).toHaveTextContent("Mean");
    expect(within(mean).getByText("Gross weight")).toBeInTheDocument();
    expect(within(mean).getByText("158.3% from the usual level")).toBeInTheDocument();
    expect(mean).not.toHaveTextContent("3.1");
    const date = screen.getByTestId("break-lm-9");
    expect(within(date).getByRole("button", { name: /Latest date/ })).toBeInTheDocument();
    expect(within(date).getByText("990 days from the usual level")).toBeInTheDocument();
    expect(date).not.toHaveTextContent("739");
    fireEvent.click(within(date).getByRole("button", { name: /Range shifted/ }));
    expect(await screen.findByTestId("monitors-explanation")).toHaveTextContent("the latest date fell back");
    expect(screen.getByTestId("monitors-detail")).not.toHaveTextContent("739");
  });
});

describe("breaks below the learned minimum", () => {
  it("lists one quietly with its code beside the description, outside the open count, and confirming moves it out", async () => {
    const u = "/monitors?fixture=1&persona=owner"; window.history.pushState({}, "", u); setUrl(u);
    renderWithQuery(<LearnedMonitors />);
    const row = await screen.findByTestId("quiet-lm-5");
    expect(within(row).getByText("MM021")).toBeInTheDocument();
    expect(within(row).getByText("Material group missing")).toBeInTheDocument();
    expect(screen.queryByTestId("break-lm-5")).toBeNull();
    expect(screen.getByTestId("monitors")).toHaveTextContent("8 open breaks");
    fireEvent.click(within(row).getByRole("button", { name: "Confirm as real" }));
    await waitFor(() => expect(screen.queryByTestId("quiet-lm-5")).toBeNull());
  });
});

describe("learned minimum effect", () => {
  it("shows the minimum now, the fixed floor, the ceiling and the decisions that moved it", async () => {
    renderWithQuery(<LearnedMonitors />);
    const row = await screen.findByTestId("threshold-material_master-fail_rate-MM014");
    expect(within(row).getByText("MM014")).toBeInTheDocument();
    expect(within(row).getByText("Base unit not valid")).toBeInTheDocument();
    expect(within(row).getByText("5.3 percentage points")).toBeInTheDocument();
    expect(within(row).getByText("2.0 percentage points")).toBeInTheDocument();
    expect(within(row).getAllByText(/marked expected by Demo steward/)).toHaveLength(2);
  });
});

describe("steward decision", () => {
  beforeEach(() => { const u = "/monitors?fixture=1&persona=owner"; window.history.pushState({}, "", u); setUrl(u); });

  it("acknowledges a break and shows who did", async () => {
    renderWithQuery(<LearnedMonitors />);
    fireEvent.click(within(await screen.findByTestId("break-lm-2")).getByRole("button", { name: "Fail rate jump" }));
    fireEvent.click(within(await screen.findByTestId("monitors-actions")).getByRole("button", { name: "Acknowledge" }));
    expect(await screen.findByText(/Acknowledged by Demo steward/)).toBeInTheDocument();
  });
});
