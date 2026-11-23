import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderScreen } from "./test-utils";
import { stubLayout } from "@/ui/testing/layout-stub";
import { Pairs } from "./Pairs";
import { Pair } from "./Pair";
import { Load } from "./Load";
import { ToastHost } from "@/ui/kit";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const runPair = vi.fn();
vi.mock("@/lib/api/v2/compare", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/compare")>()), runPair: (id: string) => runPair(id) }));

const failed = { isLoading: false, isError: true, data: undefined, refetch: vi.fn() };
vi.mock("@/lib/api/next/load", async (orig) => {
  const m = await orig<typeof import("@/lib/api/next/load")>();
  return { ...m, useLoadRuns: () => (window.location.search.includes("down=1") ? failed : m.useLoadRuns()) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  runPair.mockReset();
  window.history.replaceState(null, "", "/load?fixture=1");
});
afterEach(() => undo());

describe("Load mutations surface failure", () => {
  it("Pairs shows an error when a comparison cannot start", async () => {
    runPair.mockRejectedValue(new Error("boom"));
    renderScreen(<ToastHost><Pairs /></ToastHost>);
    fireEvent.click((await screen.findAllByRole("button", { name: "Run comparison" }))[0]);
    expect(await screen.findByText("The comparison could not be started")).toBeTruthy();
  });

  it("Pair shows an error when a comparison cannot start", async () => {
    runPair.mockRejectedValue(new Error("boom"));
    renderScreen(<ToastHost><Pair id="pair-0001" /></ToastHost>);
    fireEvent.click(await screen.findByRole("button", { name: "Run comparison" }));
    await waitFor(() => expect(screen.getByText("The comparison could not be started")).toBeTruthy());
  });

  it("Load shows Unavailable, not 0, when the runs query fails", async () => {
    window.history.replaceState(null, "", "/load?fixture=1&down=1");
    renderScreen(<Load />);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
  });
});
