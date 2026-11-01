import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as runs from "@/lib/api/v2/runs";
import { Atlas } from "../screens/Atlas";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("landscape atlas", () => {
  it("shows the latest run and moves the mosaic back when an earlier run is picked", async () => {
    renderWithQuery(<Atlas />);
    const strip = await screen.findByTestId("atlas-strip");
    const bars = within(strip).getAllByRole("button");
    expect(bars.length).toBeGreaterThan(1);
    expect(bars.at(-1)).toHaveAttribute("aria-pressed", "true");
    const mosaic = screen.getByTestId("atlas-mosaic");
    const tiles = mosaic.querySelectorAll(".m2-at-tile");
    expect(tiles.length).toBeGreaterThan(0);
    const latest = [...tiles].map((t) => t.querySelector(".m2-at-score")?.textContent).join();

    fireEvent.click(bars[0]);
    expect(bars[0]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("atlas-play")).toHaveTextContent("Play from here");
    const first = [...mosaic.querySelectorAll(".m2-at-tile")].map((t) => t.querySelector(".m2-at-score")?.textContent).join();
    expect(first).not.toEqual(latest);
    for (const t of mosaic.querySelectorAll(".m2-at-tile")) expect(t.getAttribute("href")).toMatch(/^\/o\/[^/]+\/[^/?]+\?run=/);
  });

  it("asks for a run when no run is stored", async () => {
    vi.spyOn(runs, "getTimeline").mockResolvedValue({ runs: [] } as unknown as Awaited<ReturnType<typeof runs.getTimeline>>);
    renderWithQuery(<Atlas />);
    expect(await screen.findByText("Run an analysis to see the landscape atlas.")).toBeInTheDocument();
  });
});
