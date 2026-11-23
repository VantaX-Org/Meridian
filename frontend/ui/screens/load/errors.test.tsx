import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { LoadBoard } from "./LoadBoard";
import { Gate } from "./common";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const refetch = vi.fn();
const failed = { isLoading: false, isError: true, data: undefined, refetch };
vi.mock("./hooks", async (orig) => ({
  ...(await orig<typeof import("./hooks")>()),
  usePairs: () => failed,
  usePairLatest: () => ({ ...failed, isError: false }),
  useLoadPlan: () => ({ ...failed, isError: false }),
}));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  refetch.mockClear();
  window.history.replaceState(null, "", "/load?fixture=1");
});
afterEach(() => undo());

describe("Load error states", () => {
  it("LoadBoard shows an error with retry when the pairs query fails", () => {
    renderScreen(<LoadBoard />);
    expect(screen.getByText("The load board could not be loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("Gate offers retry only when given one", () => {
    const retry = vi.fn();
    renderScreen(<Gate loading={false} error retry={retry} what="Plan">x</Gate>);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("Gate error gives the page a level-1 heading", () => {
    renderScreen(<Gate loading={false} error what="Plan">x</Gate>);
    expect(screen.getByRole("heading", { level: 1, name: "Plan could not be loaded" })).toBeTruthy();
  });
});
