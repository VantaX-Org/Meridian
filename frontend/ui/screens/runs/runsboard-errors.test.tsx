import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AletheiaProvider } from "@/ui/kit";
import { RunsBoard } from "./RunsBoard";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const refetch = vi.fn();
const failed = { isLoading: false, isError: true, data: undefined, refetch };
const landscape = { systems: [{ id: "s1" }], cells: [{ system_id: "s1", module: "material_master" }], objects: [{ module: "material_master" }] };
let land: unknown = failed;
vi.mock("@/lib/v2/queries", () => ({ useLandscape: () => land, useReceipt: () => ({ data: undefined }) }));
vi.mock("@/lib/v2/runs-queries", () => ({ useTimeline: () => ({ data: undefined }) }));
vi.mock("@/lib/v2/score", () => ({ systemForModule: () => ({ id: "s1" }) }));
vi.mock("@/lib/api/next/runs", () => ({ useRunsInfinite: () => failed }));

const retry = async () => {
  fireEvent.click((await screen.findAllByRole("button", { name: "Try again" }))[0]);
  expect(refetch).toHaveBeenCalled();
  refetch.mockClear();
};

describe("runs board failed reads", () => {
  it("landscape", async () => {
    land = failed;
    render(<AletheiaProvider><RunsBoard /></AletheiaProvider>);
    await retry();
  });
  it("runs list", async () => {
    land = { isLoading: false, isError: false, data: landscape, refetch };
    render(<AletheiaProvider><RunsBoard /></AletheiaProvider>);
    await retry();
  });
});
