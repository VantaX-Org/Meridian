import { LIBRARY } from "@/lib/api/v2/fixtures/library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as runsApi from "@/lib/api/v2/runs";
import { fixtureCompare, fixtureTimeline, resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { CompareCanvas, measuredChange, signed } from "../screens/Compare";
import { getUrl, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const RUNS = fixtureTimeline(undefined, 8).runs;
const A = RUNS[5].id; // 2 Oct, the baseline
const B = RUNS[7].id; // 16 Oct

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
  setUrl(`/run/${A}/vs/${B}?fixture=1`);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const num = (s: string) => Number(s.replace(/[^\d]/g, ""));

describe("sign and change helpers", () => {
  it("writes the sign always, with a true minus, and a dash for an unmeasured side", () => {
    expect(signed(2)).toBe("+2.0");
    expect(signed(-0.4)).toBe("−0.4");
    expect(signed(0)).toBe("0.0");
    expect(signed(null)).toBe("—");
    const side = { score: 70, raw_score: 71.8, capped: true, records_checked: 1, coverage: 1 };
    expect(measuredChange({ before: { ...side, raw_score: 69.8 }, after: side })).toBe(2);
    expect(measuredChange({ before: null, after: side })).toBeNull();
  });
});

describe("Compare canvas", () => {
  it("is titled with the later run against the baseline, and says it in one sentence", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Run 16 Oct 2026, 05:17 vs baseline 2 Oct 2026"));
    const sentence = await screen.findByTestId("compare-sentence");
    expect(norm(sentence)).toBe("12 of 15 objects scored higher and 3 lower. 14 rules started failing and 37 stopped. 12 objects are held down by a critical rule, so the score shown hides part of the problem.");
  });

  it("states the method: the common rule set, what was excluded, and what counts as changed", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const method = await screen.findByTestId("compare-method");
    expect(norm(method)).toContain("Rules are compared on the common set: the 783 rules that ran cleanly in both runs.");
    expect(norm(method)).toContain("11 rules added since the baseline of 2 Oct 2026 are excluded.");
    expect(norm(method)).toContain("fails at least 10% and 10 records more or fewer");
    expect(norm(method)).toContain("Coverage is the share of records a rule could evaluate.");
  });

  it("draws a row per object: measured before to after, the change with a diverging bar and a sign, shown before to after", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const table = await screen.findByTestId("compare-table");
    const rows = await within(table).findAllByTestId("compare-row");
    expect(rows).toHaveLength(15);
    const mm = rows.find((r) => /Material master/.test(norm(r))) as HTMLElement;
    const cells = within(mm).getAllByRole("cell").map((c) => norm(c));
    expect(cells.slice(0, 4)).toEqual(["69.8 to 71.8", "", "+2.0", "69.8 to 70.0"]);
    expect(mm.querySelector(".m2-dbar .m2-up")).not.toBeNull();
    const vm = rows.find((r) => /Accounts payable/.test(norm(r))) as HTMLElement;
    expect(norm(within(vm).getAllByRole("cell")[2])).toBe("−0.4");
    expect(vm.querySelector(".m2-dbar .m2-dn")).not.toBeNull();
    // the mark beside the sign: a circle for a rise and a square for a fall, always with the sign
    expect(within(within(mm).getByTestId("change")).getByText("+2.0").parentElement?.querySelector("svg.go")).not.toBeNull();
    expect(within(vm).getByTestId("change").querySelector("svg.nogo")).not.toBeNull();
    // the bar to the right of the zero line for a rise, to the left for a fall
    const mid = Number(mm.querySelector(".m2-dbar line")?.getAttribute("x1"));
    expect(Number(mm.querySelector(".m2-dbar .m2-up")?.getAttribute("x"))).toBe(mid);
    expect(Number(vm.querySelector(".m2-dbar .m2-dn")?.getAttribute("x"))).toBeLessThan(mid);
  });

  it("the totals row adds up the rows: new, fixed, worse and better, and the records checked before and after", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const table = await screen.findByTestId("compare-table");
    const rows = await within(table).findAllByTestId("compare-row");
    const totals = within(screen.getByTestId("compare-totals")).getAllByRole("cell").map((c) => norm(c));
    const col = (i: number) => rows.reduce((sum, r) => sum + num(norm(within(r).getAllByRole("cell")[i])), 0);
    expect([num(totals[6]), num(totals[7]), num(totals[8]), num(totals[9])]).toEqual([col(6), col(7), col(8), col(9)]);
    expect([col(6), col(7), col(8), col(9)]).toEqual([14, 37, 23, 61]);
    const S = fixtureCompare(A, B);
    const before = S.objects.reduce((s, o) => s + (o.before?.records_checked ?? 0), 0);
    const after = S.objects.reduce((s, o) => s + (o.after?.records_checked ?? 0), 0);
    expect(totals[4]).toBe(`${before.toLocaleString("en-US")} to ${after.toLocaleString("en-US")}`);
    expect(norm(screen.getByTestId("compare-totals").querySelector("th") as HTMLElement)).toBe("All 15 objects");
  });

  it("What changed lists the rules behind each count; the header count is the totals, the list is the rules, each a link to the rule inspector", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const section = await screen.findByTestId("what-changed");
    const groups = within(section).getAllByRole("heading", { level: 3 }).map((h) => norm(h));
    expect(groups).toEqual(["Newly failing rules14", "Fixed rules37", "Worse23", "Better61"]);
    const nf = section.querySelector('[data-kind="newly_failing"]') as HTMLElement;
    expect(within(nf).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(within(nf).getByRole("button", { name: "and 9 more" }));
    const items = within(nf).getAllByRole("listitem");
    expect(items).toHaveLength(14); // every rule of the count, so the list reconciles with the table
    for (const li of items) expect(within(li).getByRole("link")).toHaveAttribute("href", expect.stringContaining("open=rule%3A"));
    // Each listed rule is a rule of the shipped library, with its own message (fixtures/library.json).
    for (const li of items) {
      const id = decodeURIComponent(within(li).getByRole("link").getAttribute("href")?.split("open=rule%3A")[1]?.split("&")[0] ?? "");
      const rule = LIBRARY.find((r) => r.check_id === id);
      expect(rule, id).toBeDefined();
      expect(norm(li)).toContain(rule?.name ?? "");
    }
    // the lists agree with the per-object counts
    const fixed = section.querySelector('[data-kind="fixed"]') as HTMLElement;
    fireEvent.click(within(fixed).getByRole("button", { name: "and 32 more" }));
    expect(within(fixed).getAllByRole("listitem")).toHaveLength(37);
    fireEvent.click(within(nf).getByRole("button", { name: "Show fewer" }));
    expect(within(nf).getAllByRole("listitem")).toHaveLength(5);
  });

  it("choosing other runs in the two selects goes to that pair", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const from = await screen.findByRole("combobox", { name: "From run" });
    await waitFor(() => expect(within(from).getAllByRole("option")).toHaveLength(8));
    fireEvent.change(from, { target: { value: RUNS[0].id } });
    expect(getUrl()).toContain(`/run/${RUNS[0].id}/vs/${B}`);
  });

  it("as a list below 760px each object is a two-line row with the same figures", async () => {
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const list = await screen.findByTestId("compare-list");
    await waitFor(() => expect(within(list).getAllByRole("link")).toHaveLength(15));
    const mm = within(list).getAllByRole("link").find((l) => /Material master/.test(norm(l))) as HTMLElement;
    expect(norm(mm)).toContain("69.8 to 71.8 measured, shown 69.8 to 70.0");
    expect(norm(mm)).toContain("+2.0");
    expect(screen.getByTestId("compare-list-totals")).toHaveTextContent("All 15 objects: 14 new, 37 fixed, 23 worse, 61 better.");
  });

  it("another pair of runs reconciles the same way, and a run compared with itself changes nothing", async () => {
    const S = fixtureCompare(RUNS[0].id, RUNS[7].id);
    const sum = (k: "newly_failing" | "fixed" | "worse" | "better") => S.objects.reduce((n, o) => n + o[k], 0);
    expect([sum("newly_failing"), sum("fixed"), sum("worse"), sum("better")]).toEqual([S.totals.newly_failing, S.totals.fixed, S.totals.worse, S.totals.better]);
    const same = fixtureCompare(B, B);
    expect(same.totals.fixed + same.totals.newly_failing + same.totals.worse + same.totals.better).toBe(0);
    expect(same.objects.every((o) => o.score_change === 0)).toBe(true);
  });

  it("runs that cannot be compared are an error inside the block, with Retry", async () => {
    vi.spyOn(runsApi, "getCompareSummary").mockRejectedValue(new Error("different systems"));
    renderWithQuery(<CompareCanvas a={A} b={B} />);
    const alert = await screen.findByTestId("error-frame");
    expect(alert).toHaveTextContent("These two runs could not be compared");
  });
});
