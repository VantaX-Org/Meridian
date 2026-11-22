import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Runs } from "./Runs";
import { RunCompare } from "./RunCompare";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const id = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let undo: () => void = () => undefined;
const at = (p: string) => window.history.replaceState(null, "", `${p}${p.includes("?") ? "&" : "?"}fixture=1`);
const wrap = (ui: React.ReactNode) => renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close">{ui}</SheetHost></AletheiaProvider>);

beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

describe("runs board in fixture mode", () => {
  it("lists one object's runs on the ruler, with a compare link", async () => {
    at("/runs");
    wrap(<Runs />);
    const board = await screen.findByTestId("runs-board", undefined, { timeout: 5000 });
    expect(board).toBeTruthy();
    expect((await screen.findAllByTestId("runs-board-row", undefined, { timeout: 5000 })).length).toBeGreaterThan(1);
    expect((await screen.findAllByRole("img", { name: /shown .*measured/ })).length).toBeGreaterThan(0);
    expect(await screen.findByRole("link", { name: /^Compare Run \d+ to Run \d+$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run now" })).toBeTruthy();
  });
  it("keeps the old runs ledger below the board", async () => {
    at("/runs");
    wrap(<Runs />);
    expect(await screen.findByRole("heading", { level: 1, name: "Runs" })).toBeTruthy();
    expect(await screen.findByText("Keep the list tidy", undefined, { timeout: 5000 })).toBeTruthy();
  });
});

describe("compare board in fixture mode", () => {
  it("shows the score tiles, six dimensions and the rules that moved", async () => {
    at(`/run/${id(498)}/vs/${id(499)}`);
    wrap(<RunCompare a={id(498)} b={id(499)} objects={["material_master"]} />);
    expect(await screen.findByTestId("compare-board", undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText("Shown score")).toBeTruthy();
    expect((await screen.findAllByTestId("compare-dim")).length).toBe(6);
    expect((await screen.findAllByTestId("compare-moved")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("compare-net")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Compare runs" })).toBeTruthy();
  });
});
