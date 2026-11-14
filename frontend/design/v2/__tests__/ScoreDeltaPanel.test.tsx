import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureCompare, fixtureScoreDelta, fixtureTimeline, resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import * as runsApi from "@/lib/api/v2/runs";
import { ScoreDeltaPanel } from "../screens/ScoreDeltaPanel";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const RUNS = fixtureTimeline(undefined, 8).runs;
const A = RUNS[5].id;
const B = RUNS[7].id;

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Score delta panel", () => {
  it("adds up to the change within tolerance and shows each rule with its description", async () => {
    const S = fixtureCompare(A, B);
    renderWithQuery(<ScoreDeltaPanel a={A} b={B} S={S} />);
    const bars = await screen.findByTestId("score-delta-bars");
    const biggest = [...S.objects].sort((x, y) => Math.abs(y.score_change ?? 0) - Math.abs(x.score_change ?? 0))[0].module;
    const d = fixtureScoreDelta(A, B, biggest);
    expect(Math.abs(d.sum - d.delta)).toBeLessThanOrEqual(d.tolerance);
    const first = d.contributions.find((c) => c.check_id && c.description);
    if (first) expect(within(bars).getAllByText(first.check_id as string).length).toBeGreaterThan(0);
    expect(screen.getByTestId("score-delta-sum")).toHaveTextContent("points that changed");
    expect(within(screen.getByTestId("score-delta-narrative")).getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("says when the rule set changed between the two runs", async () => {
    const S = fixtureCompare(A, B);
    const mod = S.objects[0].module;
    vi.spyOn(runsApi, "getScoreDelta").mockResolvedValue({ ...fixtureScoreDelta(A, B, mod), rules_changed: true, rules_added: 3, rules_removed: 1 });
    renderWithQuery(<ScoreDeltaPanel a={A} b={B} S={S} />);
    expect(await screen.findByTestId("score-delta-rules-changed")).toHaveTextContent("3 rules added, 1 removed");
  });

  it("shows no rule-set notice when the rules are the same", async () => {
    const S = fixtureCompare(A, B);
    renderWithQuery(<ScoreDeltaPanel a={A} b={B} S={S} />);
    await screen.findByTestId("score-delta-bars");
    expect(screen.queryByTestId("score-delta-rules-changed")).toBeNull();
  });

  it("names each rule whose logic changed, with the hash before and after", async () => {
    const S = fixtureCompare(A, B);
    const mod = S.objects[0].module;
    vi.spyOn(runsApi, "getScoreDelta").mockResolvedValue({
      ...fixtureScoreDelta(A, B, mod), rules_changed: true,
      logic_changed: [{ check_id: "T001", description: "Field is blank", hash_before: "aaaa1111", hash_after: "bbbb2222" }],
    });
    renderWithQuery(<ScoreDeltaPanel a={A} b={B} S={S} />);
    const note = await screen.findByTestId("score-delta-logic-changed");
    expect(note).toHaveTextContent("Rules that ran with changed logic: 1.");
    expect(note).toHaveTextContent("T001 (Field is blank): logic aaaa1111 before, bbbb2222 after");
  });

  it("shows no logic note when no rule's logic changed", async () => {
    const S = fixtureCompare(A, B);
    const mod = S.objects[0].module;
    vi.spyOn(runsApi, "getScoreDelta").mockResolvedValue(fixtureScoreDelta(A, B, mod));
    renderWithQuery(<ScoreDeltaPanel a={A} b={B} S={S} />);
    await screen.findByTestId("score-delta-sum");
    expect(screen.queryByTestId("score-delta-logic-changed")).toBeNull();
  });
});
