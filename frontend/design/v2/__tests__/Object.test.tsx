import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as landscapeApi from "@/lib/api/v2/landscape";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { EmptyTab, ObjectFrame, RulesTab } from "../screens/Object";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/o/ecc-production/material-master");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

function frame(system = "ecc-production", module = "material-master") {
  return renderWithQuery(
    <ObjectFrame system={system} module={module}>
      <RulesTab system={system} module={module} />
    </ObjectFrame>,
  );
}

describe("object canvas header", () => {
  it("names the object and system, and reads the status line from the receipt", async () => {
    frame();
    const status = await screen.findByTestId("object-status");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Material master");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ECC production");
    expect(norm(status)).toContain("Run 16 Oct 2026, 05:17");
    expect(norm(status)).toContain("61,816 records checked");
    expect(norm(status)).toContain("913 rules measured");
    expect(norm(status)).toContain("25,712 to fix");
    expect(norm(status)).toContain("4.2 m at risk");
    expect(norm(status)).toContain("3 features blocked");
    expect(norm(status)).toContain("No-go for wave 1");
  });

  it("draws the 240 ruler, the measured score as the tick, and says what caps it with links to the rules", async () => {
    frame();
    const sentence = await screen.findByTestId("cap-sentence");
    await waitFor(() => expect(norm(sentence)).toContain("Capped at 70 by MM014 and MM031, two critical rules over tolerance."));
    expect(norm(sentence)).toContain("Measured 71.8");
    expect(within(sentence).getByRole("link", { name: "MM014" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM014"));
    const ruler = document.querySelector('svg[data-size="240"]');
    expect(ruler).not.toBeNull();
    expect(ruler?.classList.contains("m2-on")).toBe(true);
    expect(document.querySelector(".m2-tick")?.getAttribute("data-measured")).toBe("71.8");
    expect(screen.getByTestId("ruler-score")).toHaveTextContent("70.0");
  });
});

describe("the receipt", () => {
  it("lists each dimension with weight, score, points, rules measured, records checked and coverage", async () => {
    frame();
    const table = await screen.findByTestId("receipt");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Dimension", "Weight", "Score", "Points", "Rules measured", "Records checked", "Coverage"]);
    const completeness = within(table).getByRole("row", { name: /^Completeness/ });
    expect(within(completeness).getAllByRole("cell").map((c) => c.textContent)).toEqual(["25%", "62.0", "15.5", "213", "60,827", "98.4%"]);
    const weighted = within(table).getByRole("row", { name: /^Weighted/ });
    expect(norm(weighted)).toContain("71.8");
    expect(norm(within(table).getByRole("row", { name: /^Measured/ }))).toContain("71.8");
    expect(norm(within(table).getByRole("row", { name: /^Cap, 2 critical rules over tolerance/ }))).toContain("70.0");
    expect(norm(within(table).getByRole("row", { name: /^Score shown/ }))).toContain("70.0");
  });

  it("points add up to the weighted score", async () => {
    frame();
    const table = await screen.findByTestId("receipt");
    const points = ["Completeness", "Accuracy", "Consistency", "Timeliness", "Uniqueness", "Validity"].map((d) => Number(within(within(table).getByRole("row", { name: new RegExp(`^${d}`) })).getAllByRole("cell")[2].textContent));
    expect(Math.round(points.reduce((a, b) => a + b, 0) * 10) / 10).toBe(71.8);
  });

  it("closes with the formula, severity weights, tolerance and cap rule from the receipt", async () => {
    frame();
    const footer = await screen.findByTestId("receipt-footer");
    const t = norm(footer);
    const dot = String.fromCharCode(0xb7); // the multiplication dot the API's formula uses; the glyph is kept out of source files
    expect(t).toContain(`DQS = 0.25${dot}C + 0.25${dot}A + 0.20${dot}Cs + 0.10${dot}T + 0.10${dot}U + 0.10${dot}V`);
    expect(t).toContain("severity weights critical 4, high 3, medium 2, low 1");
    expect(t).toContain("tolerance 10% of rows or 25 rows");
    expect(t).toContain("cap rule: 85 at one critical rule over tolerance, 70 at two or more");
  });

  it("names the breaches as links, each with its failing count", async () => {
    frame();
    const list = await screen.findByTestId("breaches");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByRole("link", { name: "MM014" })).toBeInTheDocument();
    expect(norm(items[0])).toContain("Base unit of measure not valid");
    expect(norm(items[0])).toContain("3,640 failing");
    expect(norm(items[1])).toContain("2,904 failing");
  });

  it("leaves out the weighted row when the stored summary cannot reproduce it, and shows a dash for a count it does not hold", async () => {
    const real = await import("@/lib/api/v2/fixtures");
    const base = real.fixtureResponse<import("@/lib/api/v2/types").Receipt>("/objects/material_master/receipt", {});
    vi.spyOn(landscapeApi, "getReceipt").mockResolvedValue({ ...base, weighted: null, breaches: base.breaches.map((b) => ({ ...b, failing: null, pct: null })) });
    frame();
    const table = await screen.findByTestId("receipt");
    expect(within(table).queryByRole("row", { name: /^Weighted/ })).toBeNull();
    expect(within(await screen.findByTestId("breaches")).getAllByText("—")).toHaveLength(2);
  });
});

describe("tabs as route segments", () => {
  it("lists Rules, Records, Fixes, Runs, Readiness, Processes, Lineage, Glossary and Golden records as links to their segments", async () => {
    frame();
    const nav = await screen.findByRole("navigation", { name: "Views of Material master" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => (l.firstChild as Text).textContent)).toEqual(["Rules", "Records", "Fixes", "Runs", "Readiness", "Processes", "Lineage", "Glossary", "Golden records"]);
    expect(links[0]).toHaveAttribute("href", expect.stringMatching(/^\/o\/ecc-production\/material-master(\?|$)/));
    expect(links[1]).toHaveAttribute("href", expect.stringContaining("/o/ecc-production/material-master/records"));
    expect(links[5]).toHaveAttribute("href", expect.stringContaining("/o/ecc-production/material-master/processes"));
    expect(links[8]).toHaveAttribute("href", expect.stringContaining("/o/ecc-production/material-master/golden"));
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(links[1]).not.toHaveAttribute("aria-current");
  });

  it("marks the segment you are on", async () => {
    setUrl("/o/ecc-production/material-master/fixes");
    frame();
    const nav = await screen.findByRole("navigation", { name: "Views of Material master" });
    expect(within(nav).getByRole("link", { name: "Fixes" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: /^Rules/ })).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["records", /No failing records are listed for Material master yet/, "Open Work"],
    ["fixes", /No fix batches for Material master yet/, "Open Work"],
    ["runs", /Material master has no run history here yet/, "Open the runs"],
    ["readiness", /Feature impact for Material master is calculated from the rules that fail/, "Open the capping rules"],
    ["lineage", /Lineage fills when a field map is loaded/, "Open the landscape"],
    ["glossary", /No glossary terms are linked to Material master yet/, "Open the rules"],
    ["golden", /No golden records for Material master yet/, "Open the rules"],
  ] as const)("the %s tab is a designed empty frame with one action", async (tab, copy, action) => {
    renderWithQuery(
      <ObjectFrame system="ecc-production" module="material-master">
        <EmptyTab tab={tab} system="ecc-production" module="material-master" />
      </ObjectFrame>,
    );
    const frameEl = await screen.findByTestId("empty-frame");
    expect(frameEl).toHaveTextContent(copy);
    expect(within(frameEl).getAllByRole("link")).toHaveLength(1);
    expect(within(frameEl).getByRole("link", { name: action })).toBeInTheDocument();
  });
});

describe("object canvas states", () => {
  it("an object with no run on its system draws the ruler empty and says No run yet", async () => {
    setUrl("/o/s-4hana-sandbox/material-master");
    frame("s-4hana-sandbox", "material-master");
    expect(await screen.findByText(/No run yet\. The ruler fills when an analysis scores this object\./)).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName("Material master: no run yet.");
    expect(screen.getByText("Extracted, not analysed.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run analysis on S/4HANA sandbox" })).toBeInTheDocument();
  });

  it("an unknown system says so and links back to the landscape", async () => {
    frame("nowhere", "material-master");
    expect(await screen.findByText(/No system matches this address/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the landscape" })).toHaveAttribute("href", expect.stringMatching(/^\/(\?|$)/));
  });

  it("a failed landscape read is an error with Retry", async () => {
    vi.spyOn(landscapeApi, "getLandscape").mockRejectedValue(new Error("down"));
    frame();
    expect(await screen.findByTestId("error-frame")).toHaveTextContent("The object could not be read");
  });

  it("resolves a system by id as well as by slug", async () => {
    const id = landscapeFixture.systems[0].id;
    setUrl(`/o/${id}/material-master`);
    frame(id, "material-master");
    expect(await screen.findByTestId("object-status")).toBeInTheDocument();
  });
});
