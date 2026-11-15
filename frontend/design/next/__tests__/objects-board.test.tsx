import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ObjectsBoard } from "../screens/ObjectsBoard";
import { setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => window.sessionStorage.clear());

describe("objects board", () => {
  it("leads with how the scores spread, then a table per system linking to each object", async () => {
    setUrl("/objects?fixture=1");
    renderWithQuery(<ObjectsBoard />);
    const lead = await screen.findByTestId("lead-objects");
    expect(within(lead).getByTestId("lead-chart-objects")).toBeTruthy();
    expect((await screen.findAllByTestId("objects-system")).length).toBeGreaterThan(0);
    const rows = screen.getAllByTestId("objects-row");
    expect(within(rows[0]).getAllByRole("link")[0].getAttribute("href")).toMatch(/\/o\//);
    expect(screen.getByRole("link", { name: /^Open .+ on / }).getAttribute("href")).toMatch(/^\/o\/[^/]+\/[^/?]+/);
  });

  it("narrows to one object from ?module= and links back to all objects", async () => {
    setUrl("/objects?fixture=1&module=material-master");
    renderWithQuery(<ObjectsBoard />);
    const banner = await screen.findByTestId("objects-module-filter");
    expect(within(banner).getByRole("link", { name: "Show all objects" }).getAttribute("href")).toMatch(/^\/objects/);
    for (const row of screen.getAllByTestId("objects-row")) expect(within(row).getAllByRole("link")[0].getAttribute("href")).toMatch(/\/material-master/);
  });

  it("says when the board is pinned to one run and links back to the newest runs", async () => {
    setUrl("/objects?fixture=1&run=abc");
    renderWithQuery(<ObjectsBoard />);
    expect((await screen.findByRole("link", { name: "Show each object at its newest run" })).getAttribute("href")).toMatch(/^\/objects/);
  });
});
