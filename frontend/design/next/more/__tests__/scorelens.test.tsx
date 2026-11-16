import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/score";
import { ScoreLens } from "../ScoreLens";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/insights?tab=score");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Score lens", () => {
  it("shows the banner and every panel", async () => {
    renderWithQuery(<ScoreLens />);
    expect(await screen.findByTestId("sl-banner")).toBeInTheDocument();
    for (const id of ["sl-trend", "sl-runs", "sl-heat", "sl-modules", "sl-aware"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("shows an empty state when no run is scored", async () => {
    vi.spyOn(api, "getScoreHistory").mockResolvedValue({ history: [], modules: {} });
    vi.spyOn(api, "getHeatmap").mockResolvedValue({ version_id: "v", dimensions: [], rows: [] });
    vi.spyOn(api, "getConfigAwareScore").mockRejectedValue({ status: 404 });
    renderWithQuery(<ScoreLens />);
    expect(await screen.findByText("No run has been scored yet")).toBeInTheDocument();
    expect(screen.getByText("No run has been scored yet.")).toBeInTheDocument();
    expect(await screen.findByText("No finished run to score against the configuration yet.")).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getScoreHistory").mockRejectedValue(new Error("down"));
    renderWithQuery(<ScoreLens />);
    expect(await screen.findByText("The score history could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("sl-banner")).toBeInTheDocument();
  });
});
