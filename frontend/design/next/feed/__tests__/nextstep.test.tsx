// The feed's native next-step button: one link per persona, same targets as the v2 NextStep it replaces.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import type { Landscape } from "@/lib/api/v2/types";
import { NextStep } from "../NextStep";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const systems = vi.fn(() => ({ data: [] as { id: string; name: string; health_status: string }[] }));
vi.mock("@/lib/v2/runs-queries", async (orig) => ({ ...(await orig<typeof import("@/lib/v2/runs-queries")>()), useSystemsExtended: () => systems() }));

const landscape = {
  scope: "current", run_id: null, objects: [], cells: [], counts: { go: 0, at_risk: 0, no_go: 0 },
  systems: [{ id: "s1", name: "KMP", state: "extracted" }],
} as unknown as Landscape;

beforeEach(() => {
  setUrl("/");
  systems.mockReturnValue({ data: [] });
});

describe("NextStep", () => {
  it("sends the administrator to Administration", () => {
    renderWithQuery(<NextStep landscape={landscape} persona="admin" />);
    expect(screen.getByRole("link", { name: "Open Administration" })).toHaveAttribute("href", expect.stringContaining("/admin"));
  });

  it("sends the auditor to the rules library", () => {
    renderWithQuery(<NextStep landscape={landscape} persona="auditor" />);
    expect(screen.getByRole("link", { name: "Open the rules library" })).toHaveAttribute("href", expect.stringContaining("/rules"));
  });

  it("puts a refused sign-in first for basis, else the next analysis", () => {
    systems.mockReturnValue({ data: [{ id: "s1", name: "KMP", health_status: "auth_failed" }] });
    const { unmount } = renderWithQuery(<NextStep landscape={landscape} persona="basis" />);
    expect(screen.getByTestId("basis-fix-signin")).toHaveTextContent("Fix the KMP sign-in");
    unmount();
    systems.mockReturnValue({ data: [] });
    renderWithQuery(<NextStep landscape={landscape} persona="basis" />);
    expect(screen.getByRole("link", { name: "Run analysis on KMP" })).toBeInTheDocument();
  });

  it("falls back to the no-go objects without a wave", () => {
    renderWithQuery(<NextStep landscape={landscape} persona={"lead" as never} />);
    expect(screen.getByRole("link", { name: "Open the no-go objects" })).toHaveAttribute("href", expect.stringContaining("verdict=no-go"));
  });
});
