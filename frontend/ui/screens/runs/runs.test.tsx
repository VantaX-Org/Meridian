import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Runs } from "./Runs";
import { Run } from "./Run";
import { RunCompare } from "./RunCompare";
import { Agreement } from "./Agreement";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const id = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let undo: () => void = () => undefined;
const at = (p: string) => window.history.replaceState(null, "", `${p}${p.includes("?") ? "&" : "?"}fixture=1`);
const wrap = (ui: React.ReactNode) => renderWithQuery(<AletheiaProvider>{ui}</AletheiaProvider>);

beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

describe("runs screens in fixture mode", () => {
  it("Runs lists runs", async () => {
    at("/runs");
    wrap(<Runs />);
    expect(await screen.findByRole("heading", { level: 1, name: "Runs" })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
  });
  it("Runs timeline lists finished runs with each object's name beside its code", async () => {
    at("/runs?view=full");
    wrap(<Runs />);
    expect(await screen.findByRole("tab", { name: "Timeline", selected: true })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Material master/).length).toBeGreaterThan(0);
  });
  it("Run shows a heading", async () => {
    at(`/run/${id(499)}`);
    wrap(<Run id={id(499)} />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
  });
  it("RunCompare shows its title", async () => {
    at(`/run/${id(499)}/vs/${id(498)}`);
    wrap(<RunCompare a={id(499)} b={id(498)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Compare runs" })).toBeTruthy();
  });
  it("RunCompare shows one object across three runs", async () => {
    at(`/run/${id(497)}/vs/${id(499)}`);
    wrap(<RunCompare a={id(497)} b={id(499)} runs={[id(497), id(498), id(499)]} />);
    expect(await screen.findByTestId("compare-object")).toBeTruthy();
    expect(await screen.findByTestId("compare-side")).toBeTruthy();
    expect(await screen.findByTestId("compare-rules")).toBeTruthy();
    expect(await screen.findByTestId("compare-step-1")).toBeTruthy();
  });
  it("Agreement shows its title", async () => {
    at(`/run/${id(499)}/agreement`);
    wrap(<Agreement id={id(499)} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Agreement with the cleaned file" })).toBeTruthy();
  });
  it("registers the four sheets", () => {
    for (const k of ["cycle", "upload", "compare", "extract-target"]) expect(SHEETS[k]).toBeTruthy();
    expect(SheetHost).toBeTruthy();
  });
});
