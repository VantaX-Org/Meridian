import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/mining";
import { ToastProvider } from "../../../kit";
import { DataMining } from "../Mining";

const Q = vi.hoisted(() => ({ can: (() => true) as (p: string) => boolean }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = () => renderWithQuery(<ToastProvider><DataMining /></ToastProvider>);
beforeEach(() => { Q.can = () => true; setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Data mining (native)", () => {
  it("renders the fixture findings with the field text beside each code", async () => {
    wrap();
    expect((await screen.findByTestId("mining")).textContent).toMatch(/likely duplicate pairs/);
    const out = await screen.findByTestId("mining-outliers");
    await waitFor(() => expect(within(out).getAllByRole("row").length).toBeGreaterThan(1));
  });

  it("starts mining on the latest runs", async () => {
    const run = vi.spyOn(api, "runMining").mockResolvedValue({} as never);
    wrap();
    const btn = await screen.findByTestId("mining-run");
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(run).toHaveBeenCalled());
  });

  it("hides the mine action without mdm.write and says a 403 cannot be read", async () => {
    Q.can = (p) => p !== "mdm.write";
    vi.spyOn(api, "getMiningOverview").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the mining results.")).toBeInTheDocument();
    expect(screen.queryByTestId("mining-run")).toBeNull();
  });
});
