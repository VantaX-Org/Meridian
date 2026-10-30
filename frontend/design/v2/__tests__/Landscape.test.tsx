import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as landscapeApi from "@/lib/api/v2/landscape";
import * as reportsApi from "@/lib/api/v2/reports";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { LandscapeCanvas } from "../screens/Landscape";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const ECC = landscapeFixture.systems[0];
let undo: () => void = () => undefined;

function visit(search = "") {
  window.history.pushState({}, "", `/v2?fixture=1${search}`);
  setUrl(`/v2?fixture=1${search}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  undo = stubLayout();
  visit();
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

const text = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("landscape canvas, fixture mode", () => {
  it("opens on the sentence from /landscape: 11 of 15 held under 85 by 70 critical rules, MM014 and MM031 would release 2", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const sentence = await screen.findByTestId("landscape-sentence");
    expect(text(sentence)).toBe("11 of 15 objects are held under 85 by 70 critical rules over tolerance; fixing MM014 and MM031 would release 2 of them.");
    expect(within(sentence).getByRole("link", { name: "MM014" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM014"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Landscape");
    expect(screen.getByText(/400,662 records checked/)).toBeInTheDocument();
    expect(screen.getByText(/5,178 rules measured/)).toBeInTheDocument();
  });

  it("draws the coverage matrix: 3 systems as columns with version, client, last extraction and records; 15 objects as rows", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const table = await screen.findByTestId("coverage-matrix");
    const heads = within(table).getAllByRole("columnheader");
    expect(heads.map((h) => (h.querySelector(".m2-hn") ?? h).textContent)).toEqual(["Object", "ECC production", "S/4HANA sandbox", "SuccessFactors"]);
    expect(within(table).getByText("ECC 6.0 EHP8, client 100")).toBeInTheDocument();
    expect(within(table).getByText("Extracted 16 Oct 2026, 04:41, 400,662 records")).toBeInTheDocument();
    expect(within(table).getByText("S/4HANA 2023, client 200")).toBeInTheDocument();
    expect(within(table).getByText(/Extracted 14 Oct 2026, 22:10, 212,480 records/)).toBeInTheDocument();
    expect(within(table).getByText(/Not extracted yet\./)).toBeInTheDocument();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(15);
    expect(within(table).getAllByTestId("matrix-cell")).toHaveLength(15);
  });

  it("a cell is a 48 ruler, the score, the word capped, a verdict mark with its word and 'N rec, M rules'", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const table = await screen.findByTestId("coverage-matrix");
    const row = within(table).getByRole("row", { name: /Material master/ });
    const cell = within(row).getByTestId("matrix-cell");
    expect(cell.querySelector('svg[data-size="48"]')).not.toBeNull();
    expect(within(cell).getByTestId("ruler-score")).toHaveTextContent("70.0");
    expect(within(cell).getByText("capped")).toBeInTheDocument();
    expect(within(cell).getByText("No-go")).toBeInTheDocument();
    expect(within(cell).getByText("61,816 rec, 913 rules")).toBeInTheDocument();
    expect(cell).toHaveAttribute("href", expect.stringMatching(/^\/v2\/o\/ecc-production\/material-master/));
    expect(cell).toHaveAccessibleName("Material master, ECC production, 70.0 capped, No-go, 3 data contract thresholds breached, not enforced");
    const go = within(within(table).getByRole("row", { name: /G\/L accounts/ })).getByTestId("matrix-cell");
    expect(within(go).getByText("Go")).toBeInTheDocument();
    expect(within(go).queryByText("capped")).toBeNull();
  });

  it("marks low coverage with a word, and says honestly what the other systems are", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const table = await screen.findByTestId("coverage-matrix");
    const pm = within(table).getByRole("row", { name: /Plant maintenance/ });
    expect(within(pm).getByText("low coverage")).toBeInTheDocument();
    expect(within(pm).getByText("Not analysed")).toBeInTheDocument();
    expect(within(pm).getByText("Not extracted")).toBeInTheDocument();
    expect(within(table).getAllByText("Not analysed")).toHaveLength(15);
  });

  it("outlines the selected cell in the data hue: the one last opened", async () => {
    window.sessionStorage.setItem("mn_v2_sel", `${ECC.id}:material_master`);
    renderWithQuery(<LandscapeCanvas />);
    const cells = await screen.findAllByTestId("matrix-cell");
    const selected = cells.filter((c) => c.getAttribute("data-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAccessibleName(/Material master/);
    expect(selected[0].querySelector(".m2-ruler.m2-on")).not.toBeNull();
  });

  it("remembers the cell you click for the way back", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const cells = await screen.findAllByTestId("matrix-cell");
    fireEvent.click(cells[3]);
    expect(window.sessionStorage.getItem("mn_v2_sel")).toBe(`${ECC.id}:${landscapeFixture.cells[3].module}`);
  });

  it("lead: the next step reads the wave data: it clears the no-go objects of the next wave", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const next = await screen.findByRole("link", { name: "Clear the 3 no-go objects in Wave 1: finance foundations" });
    expect(next).toHaveAttribute("href", expect.stringContaining("/v2/work?verdict=no-go"));
    expect(next).toHaveClass("m2-next");
    expect(text(screen.getByTestId("wave-next-when"))).toMatch(/^Wave 1: finance foundations: due 16 Nov 2026, .* 1 go, 0 at risk, 3 no-go\.$/);
  });

  it("lead: with no wave defined the next step opens the no-go objects, as before", async () => {
    vi.spyOn(reportsApi, "getWaves").mockResolvedValue([]);
    renderWithQuery(<LandscapeCanvas />);
    const next = await screen.findByRole("link", { name: "Open the no-go objects" });
    expect(next).toHaveAttribute("href", expect.stringContaining("/v2/work?verdict=no-go"));
  });

  it("steward: the next step accepts the suggested values in Work", async () => {
    visit("&persona=steward");
    renderWithQuery(<LandscapeCanvas />);
    const next = await screen.findByRole("link", { name: "Accept the suggested values" });
    expect(next).toHaveAttribute("href", expect.stringContaining("/v2/work"));
  });

  it("process analyst: the next step opens the first blocked process step, PTP step 3", async () => {
    visit("&persona=process");
    renderWithQuery(<LandscapeCanvas />);
    const next = await screen.findByRole("link", { name: "Open PTP step 3" });
    expect(next.getAttribute("href")).toContain("/processes?open=step:material_master:PTP-GR-MIGO");
    expect(next).toHaveClass("m2-next");
  });

  it("basis: the next step extracts the system that was never extracted, in the system inspector, and lists system tasks instead of rows", async () => {
    visit("&persona=basis");
    renderWithQuery(<LandscapeCanvas />);
    const next = await screen.findByRole("link", { name: "Extract SuccessFactors" });
    expect(next.getAttribute("href")).toContain("open=system%3Aa1b2c3d4-0003");
    expect(await screen.findByText("Run analysis on S/4HANA sandbox")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("Your next work: the top 5 rows by value at risk in the grid, with View all N", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const grid = await screen.findByRole("grid", { name: "Your next work" });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(6)); // header plus 5
    const rows = within(grid).getAllByRole("row").slice(1);
    const values = rows.map((r) => Number(text(within(r).getAllByRole("gridcell").at(-1) as HTMLElement).replace(/[^\d]/g, "")));
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(within(grid).getByRole("columnheader", { name: "Value at risk" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all 25,712" })).toHaveAttribute("href", expect.stringContaining("/v2/work"));
    expect(screen.getByText("Rows ranked by value at risk, cost model ZAR v3.")).toBeInTheDocument();
  });

  it("opens a row's record in the inspector through the URL", async () => {
    renderWithQuery(<LandscapeCanvas />);
    const grid = await screen.findByRole("grid", { name: "Your next work" });
    await waitFor(() => expect(within(grid).getAllByRole("row")).toHaveLength(6));
    fireEvent.click(within(grid).getAllByRole("row")[1]);
    expect(getUrl()).toContain("open=record%3Amaterial_master%3AMATNR%3D");
  });

  it("has one h1 and names the scope and the coverage counts", async () => {
    renderWithQuery(<LandscapeCanvas />);
    await screen.findByTestId("coverage-matrix");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("2 go, 2 at risk, 11 no-go")).toBeInTheDocument();
    expect(screen.getByText("All systems")).toBeInTheDocument();
  });

  it("with ?run= says which run the scores come from, and the way back", async () => {
    visit("&run=b0100000-0000-4000-8000-000000000001");
    renderWithQuery(<LandscapeCanvas />);
    expect(await screen.findByRole("status")).toHaveTextContent("Viewing one run");
    expect(screen.getByRole("link", { name: "Back to the latest run" })).toBeInTheDocument();
  });
});

describe("landscape canvas, honest states", () => {
  it("while loading keeps the title and draws flat placeholders", () => {
    renderWithQuery(<LandscapeCanvas />);
    expect(screen.getByTestId("landscape-loading")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Landscape");
  });

  it("a failed read is an error inside the block with Retry", async () => {
    const spy = vi.spyOn(landscapeApi, "getLandscape").mockRejectedValue(new Error("down"));
    renderWithQuery(<LandscapeCanvas />);
    const alert = await screen.findByTestId("error-frame");
    expect(alert).toHaveTextContent("The landscape could not be read");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  });

  it("a tenant with no system keeps the frame and offers the one action", async () => {
    vi.spyOn(landscapeApi, "getLandscape").mockResolvedValue({ ...landscapeFixture, systems: [], cells: [], objects: [] });
    renderWithQuery(<LandscapeCanvas />);
    expect(await screen.findByText(/No SAP system is connected yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect a system" })).toHaveAttribute("href", "/systems");
  });

  it("systems with no run yet say so: zero objects scored, rows empty with their reason", async () => {
    vi.spyOn(landscapeApi, "getLandscape").mockResolvedValue({
      ...landscapeFixture,
      cells: [],
      sentence: { held_under_85: 0, objects: 0, critical_over_tolerance: 0, release_if_fixed: [], released: 0 },
      counts: { go: 0, at_risk: 0, no_go: 0 },
    });
    vi.spyOn(landscapeApi, "getTopWork").mockResolvedValue({ version_id: null, total: 0, total_capped: false, next: null, items: [] });
    renderWithQuery(<LandscapeCanvas />);
    expect(await screen.findByText("No object has a run yet. Extract a system and run an analysis to score it.")).toBeInTheDocument();
    expect(await screen.findByText(/Nothing is waiting because no run has scored an object yet/)).toBeInTheDocument();
    expect(screen.getByText("0 go, 0 at risk, 0 no-go")).toBeInTheDocument();
  });
});
