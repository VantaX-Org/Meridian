import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { byObject, Mining, runsToMine } from "../screens/Mining";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

const perm = vi.hoisted(() => ({ write: true }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ ...m.useV2Session(), can: (a: string) => (a === "mdm.write" ? perm.write : true) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/mining");
  perm.write = true;
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("data mining", () => {
  it("shows the duplicates, outliers and relationships with their field descriptions", async () => {
    renderWithQuery(<Mining />);
    const dupes = await screen.findByTestId("mining-duplicates");
    expect(await within(dupes).findByText("000000000010004711")).toBeInTheDocument();
    const out = screen.getByTestId("mining-outliers");
    expect(await within(out).findByText("250,000,000")).toBeInTheDocument();
    const rel = screen.getByTestId("mining-relationships");
    expect(await within(rel).findAllByText("BRGEW")).not.toHaveLength(0);
    expect(await screen.findByTestId("mining-patterns")).toBeInTheDocument();
  });

  it("shows the locked reason in place of the mine button when the role cannot write master data", async () => {
    perm.write = false;
    renderWithQuery(<Mining />);
    await screen.findByTestId("mining-duplicates");
    expect(screen.getByTestId("mining-locked")).toHaveTextContent("master data write permission");
    expect(screen.queryByTestId("mining-run")).toBeNull();
  });

  it("counts findings per object and groups runs to mine", () => {
    const d = [{ module_id: "a" }, { module_id: "b" }, { module_id: "b" }, { module_id: "b" }] as never[];
    const o = [{ module_id: "a" }] as never[];
    expect(byObject(d, o)).toEqual([{ module: "b", dupes: 3, outliers: 0 }, { module: "a", dupes: 1, outliers: 1 }]);
    const runs = runsToMine([{ run_id: "r1", module: "x" }, { run_id: "r1", module: "y" }, { run_id: null, module: "z" }, { run_id: "r1", module: "x" }]);
    expect([...runs]).toEqual([["r1", ["x", "y"]]]);
  });
});
