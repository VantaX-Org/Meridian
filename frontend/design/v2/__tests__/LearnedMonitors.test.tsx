import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
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
