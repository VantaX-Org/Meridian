import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { resetLearnedMonitors } from "@/lib/api/v2/fixtures/learnedMonitors";
import { ToastProvider } from "../../kit";
import { LearnedMonitors } from "../LearnedMonitors";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const Q = vi.hoisted(() => ({ can: (a: string): boolean => a !== "" }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "u-me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = () => renderWithQuery(<ToastProvider><LearnedMonitors /></ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more?fixture=1");
  resetLearnedMonitors();
  Q.can = () => true;
});

describe("LearnedMonitors (native)", () => {
  it("renders the fixture breaks with every code beside its text", async () => {
    wrap();
    const breaks = await screen.findByTestId("monitors-breaks");
    expect(within(breaks).getAllByText("MARA.BRGEW").length).toBeGreaterThan(0);
    expect(within(breaks).getAllByText(/Gross weight/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("monitors-coverage")).toBeTruthy();
    expect(screen.getByTestId("monitors-chart")).toBeTruthy();
    expect(screen.getByTestId("monitors-below-minimum")).toBeTruthy();
    expect(screen.getByTestId("monitors-thresholds")).toBeTruthy();
  });

  it("opens the breached monitor and acknowledges it", async () => {
    wrap();
    fireEvent.click(await screen.findByTestId("monitors-open-breached"));
    const actions = await screen.findByTestId("monitors-actions");
    const before = within(screen.getByTestId("monitors-detail")).getByTestId("monitors-explanation").textContent;
    expect(before).toBeTruthy();
    fireEvent.click(within(actions).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(within(screen.getByTestId("monitors-detail")).getByText(/Acknowledged by/)).toBeTruthy());
  });

  it("hides decisions without mdm.write but keeps the explain action", async () => {
    Q.can = (a) => a !== "mdm.write";
    wrap();
    await screen.findByTestId("monitors-detail");
    expect(screen.queryByTestId("monitors-actions")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm as real" })).toBeNull();
    expect(screen.getByTestId("monitors-explain")).toBeTruthy();
  });
});
