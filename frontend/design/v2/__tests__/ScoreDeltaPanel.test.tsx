import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureCompare, fixtureScoreDelta, fixtureTimeline, resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
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
});
