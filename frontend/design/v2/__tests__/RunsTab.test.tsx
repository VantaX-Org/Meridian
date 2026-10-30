import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import { RunsTab } from "../screens/object/RunsTab";
import { chartGeometry, yOf, GRID, Y_MAX, Y_MIN, type ChartPoint } from "../screens/object/ScoreChart";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const CURRENT = "d3229ded-0708-4967-9dfb-1b7f4fada953";
const BASELINE = "b0500000-0000-4000-8000-000000000005";
const FIRST = "b0000000-0000-4000-8000-000000000000";

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/o/ecc-production/material-master/runs?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** A list row read as its columns, joined by a space: the columns are separate grid cells on screen. */
const cols = (li: Element) => Array.from(li.children).map((c) => norm(c as HTMLElement)).filter(Boolean).join(" ");
const render = () => renderWithQuery(<RunsTab system="ecc-production" module="material-master" />);
const css = readFileSync(join(__dirname, "..", "object.css"), "utf8");

describe("the score chart geometry", () => {
  const points: ChartPoint[] = [66.2, 67, 66.8, 68.9, 69.4, 69.8, 70.9, 71.8].map((m, i) => ({ id: `r${i}`, label: `d${i}`, title: `d${i}`, measured: m, baseline: i === 5 }));

  it("scales y from 60 at the bottom to 100 at the top, linearly, and clamps outside", () => {
    expect(Y_MIN).toBe(60);
    expect(Y_MAX).toBe(100);
    const g = chartGeometry(points, 70);
    expect(yOf(100)).toBe(g.plot.top);
    expect(yOf(60)).toBe(g.axisY);
    expect(g.axisY).toBe(g.plot.bottom);
    expect(yOf(80)).toBeCloseTo((g.plot.top + g.plot.bottom) / 2, 1);
    expect(yOf(40)).toBe(yOf(60));
    expect(yOf(120)).toBe(yOf(100));
    // 71.8 sits above 70 and below 80
    expect(yOf(71.8)).toBeLessThan(yOf(70));
    expect(yOf(71.8)).toBeGreaterThan(yOf(80));
  });

  it("has four gridlines, at 70, 80, 90 and 100", () => {
    expect(GRID).toEqual([70, 80, 90, 100]);
    expect(chartGeometry(points, null).gridY.map((l) => l.value)).toEqual([70, 80, 90, 100]);
  });

  it("puts the cap and the baseline where the scale and the runs say", () => {
    const g = chartGeometry(points, 70);
    expect(g.capY).toBe(yOf(70));
    expect(g.baselineX).toBe(g.xs[5]);
    expect(chartGeometry(points, null).capY).toBeNull();
    expect(chartGeometry(points.map((p) => ({ ...p, baseline: false })), 70).baselineX).toBeNull();
    expect(chartGeometry(points, 55).capY).toBeNull(); // off the scale
  });

  it("spaces the runs evenly from the left edge of the plot to the right edge", () => {
    const g = chartGeometry(points, 70);
    expect(g.xs[0]).toBe(g.plot.left);
    expect(g.xs[7]).toBe(g.plot.right);
    const steps = g.xs.slice(1).map((x, i) => x - g.xs[i]);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.02);
  });
});

describe("the Runs tab chart", () => {
  it("draws one 2 pixel line through the last 8 runs, with four gridlines and the 60 to 100 axis labels", async () => {
    render();
    const svg = await screen.findByTestId("score-chart");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAccessibleName("Measured score of Material master, last 8 runs: 67.8 on 28 Aug, 71.8 on 16 Oct. Baseline run 2 Oct. Cap 70.");
    const line = within(svg as unknown as HTMLElement).getByTestId("score-line");
    expect(line.getAttribute("points")?.split(" ")).toHaveLength(8);
    expect(css).toMatch(/\.m2-chart \.m2-ln \{[^}]*stroke: var\(--m2-data\);[^}]*stroke-width: 2;/);
    expect(svg.querySelectorAll("line.m2-gl")).toHaveLength(4);
    const labels = Array.from(svg.querySelectorAll("text.m2-ax")).map((t) => t.textContent);
    for (const v of ["60", "70", "80", "90", "100"]) expect(labels).toContain(v);
  });

  it("has no markers and no legend, and the hue is on the series alone", async () => {
    render();
    const svg = await screen.findByTestId("score-chart");
    expect(svg.querySelectorAll("circle, marker, [class*='legend']")).toHaveLength(0);
    const dataUses = css.split("\n").filter((l) => l.startsWith(".m2-chart") && l.includes("var(--m2-data)"));
    expect(dataUses.map((l) => l.split(" {")[0])).toEqual([".m2-chart .m2-ln", ".m2-chart .m2-lab"]);
  });

  it("draws the cap level dashed and names it", async () => {
    render();
    const cap = await screen.findByTestId("cap-line");
    expect(cap).toHaveAttribute("data-level", "70");
    expect(cap.getAttribute("class")).toBe("m2-capl");
    expect(css).toMatch(/\.m2-chart \.m2-capl \{[^}]*stroke-dasharray: 4 3/);
    expect(screen.getByText("cap 70")).toBeInTheDocument();
    expect(Number(cap.getAttribute("y1"))).toBe(yOf(70));
  });

  it("marks the baseline run with a 1 pixel vertical rule at that run, and names it", async () => {
    render();
    const rule = await screen.findByTestId("baseline-rule");
    const points = screen.getByTestId("score-line").getAttribute("points")?.split(" ") ?? [];
    expect(Number(rule.getAttribute("x1"))).toBe(Number(points[5].split(",")[0]));
    expect(rule.getAttribute("x1")).toBe(rule.getAttribute("x2"));
    expect(css).toMatch(/\.m2-chart \.m2-vbar \{[^}]*stroke-width: 1;/);
    expect(screen.getByText("baseline 2 Oct")).toBeInTheDocument();
  });

  it("lists the runs under the chart, latest first, with measured, shown and records checked", async () => {
    render();
    const t = await screen.findByRole("table", { name: "Runs shown in the chart" });
    const rows = within(t).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    expect(Array.from(rows[0].querySelectorAll("th,td")).map((c) => norm(c as HTMLElement))).toEqual(["Run 16 Oct 2026, 05:17", "71.8", "70.0", "400,662"]);
    expect(norm(rows[2])).toContain("baseline"); // 2 Oct
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", expect.stringContaining(`open=run%3A${CURRENT}`));
  });
});

describe("why the score moved", () => {
  it("names the two runs and totals the measured score", async () => {
    render();
    const why = await screen.findByTestId("why-moved");
    await waitFor(() => expect(within(why).getByText("Measured score")).toBeInTheDocument());
    expect(within(why).getByRole("heading", { name: "Why the score moved" })).toBeInTheDocument();
    expect(norm(why)).toContain("16 Oct 2026 against 2 Oct 2026");
    const tot = within(why).getByText("Measured score").closest("li") as HTMLElement;
    expect(cols(tot)).toBe("Measured score 69.8 on 2 Oct 2026, 71.8 on 16 Oct 2026 +2.0");
    expect(screen.getByTestId("shown-note")).toHaveTextContent("The shown score moved only 69.8 to 70.0, because the cap holds it at 70.0.");
  });

  it("lists the rules that changed, by kind, each rule id a link that opens it", async () => {
    render();
    const why = await screen.findByTestId("why-moved");
    await waitFor(() => expect(within(why).getByRole("link", { name: "MM119" })).toBeInTheDocument());
    const heads = Array.from(why.querySelectorAll("li.m2-whyh")).map(cols);
    expect(heads).toEqual(["Newly failing 3 rules", "Fixed 9 rules", "Worse 3 rules", "Better 20 rules"]);
    const row = (id: string) => cols(within(why).getByRole("link", { name: id }).closest("li") as HTMLElement);
    expect(row("MM119")).toBe("MM119 Net weight above gross weight 240 records newly failing +240");
    expect(row("MM091")).toBe("MM091 Valuation class missing 377 records fixed −377");
    expect(row("MM057")).toBe("MM057 Gross weight missing 70 more records failing +70");
    expect(row("MM022")).toBe("MM022 Material group missing 340 records fixed −340");
    expect(within(why).getByRole("link", { name: "MM022" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM022"));
  });

  it("shows the biggest three of each kind and counts the rest", async () => {
    render();
    const why = await screen.findByTestId("why-moved");
    await waitFor(() => expect(within(why).getByRole("link", { name: "MM119" })).toBeInTheDocument());
    expect(within(why).getAllByRole("link", { name: /^MM\d+$/ })).toHaveLength(3 + 3 + 3 + 3);
    expect(norm(why)).toContain("and 17 more rules"); // better: 20, 3 shown
    expect(norm(why)).toContain("and 6 more rules"); // fixed: 9, 3 shown
  });

  it("says so when no rule changed, and when the comparison cannot be read", async () => {
    vi.spyOn(objectApi, "getChangedChecks").mockResolvedValue({ newly_failing: [], fixed: [], worse: [], better: [] });
    const { unmount } = render();
    expect(await screen.findByText("No rule changed enough between these two runs to move the score.")).toBeInTheDocument();
    unmount();
    vi.spyOn(objectApi, "getCompareSummary").mockRejectedValue(new Error("down"));
    render();
    expect(await screen.findByText("The comparison of these two runs could not be read.")).toBeInTheDocument();
  });
});

describe("Compare with…", () => {
  it("links the baseline and the current run to /run/{a}/vs/{b}, and follows the pair that is picked", async () => {
    render();
    const form = await screen.findByRole("form", { name: "Compare two runs" });
    expect(within(form).getByText("Compare with…")).toBeInTheDocument();
    expect(within(form).getByRole("link", { name: "Compare" })).toHaveAttribute("href", expect.stringContaining(`/run/${BASELINE}/vs/${CURRENT}`));
    fireEvent.change(within(form).getByLabelText("Earlier run"), { target: { value: FIRST } });
    expect(within(form).getByRole("link", { name: "Compare" })).toHaveAttribute("href", expect.stringContaining(`/run/${FIRST}/vs/${CURRENT}`));
  });

  it("offers every run of the chart in both pickers and will not compare a run with itself", async () => {
    render();
    const form = await screen.findByRole("form", { name: "Compare two runs" });
    expect(within(within(form).getByLabelText("Earlier run")).getAllByRole("option")).toHaveLength(8);
    fireEvent.change(within(form).getByLabelText("Earlier run"), { target: { value: CURRENT } });
    expect(within(form).queryByRole("link", { name: "Compare" })).toBeNull();
    expect(within(form).getByRole("button", { name: "Compare" })).toBeDisabled();
  });
});

describe("states", () => {
  it("fills from the second run: one run says so", async () => {
    const real = await import("@/lib/api/v2/fixtures");
    const full = real.fixtureResponse<objectApi.Timeline>("/runs/timeline", {});
    vi.spyOn(objectApi, "getTimeline").mockResolvedValue({ ...full, runs: [full.runs[7]] });
    render();
    expect(await screen.findByText(/Material master has one scored run so far, measured 71\.8 and shown 70\.0\./)).toBeInTheDocument();
  });

  it("a failed read is an error with Retry", async () => {
    vi.spyOn(objectApi, "getTimeline").mockRejectedValue(new Error("down"));
    render();
    const alert = await screen.findByTestId("error-frame");
    expect(alert).toHaveTextContent("The run history could not be read.");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("the chart on a phone", () => {
  const points: ChartPoint[] = [66.2, 67, 66.8, 68.9, 69.4, 69.8, 70.9, 71.8].map((m, i) => ({ id: `r${i}`, label: `d${i}`, title: `d${i}`, measured: m, baseline: i === 5 }));

  it("is drawn at the width it is shown at, so the text keeps its size", () => {
    expect(chartGeometry(points, 70, true).width).toBe(340);
    expect(chartGeometry(points, 70, false).width).toBe(560);
    expect(chartGeometry(points, 70, true).plot.right).toBe(340 - 76);
  });

  it("names every other date, the last one always", async () => {
    const { ScoreChart } = await import("../screens/object/ScoreChart");
    const { container } = renderWithQuery(<ScoreChart points={points} capLevel={70} label="x" compact />);
    const labels = Array.from(container.querySelectorAll("text.m2-ax")).map((t) => t.textContent).filter((t) => t?.startsWith("d"));
    expect(labels).toEqual(["d1", "d3", "d5", "d7"]);
  });
});
