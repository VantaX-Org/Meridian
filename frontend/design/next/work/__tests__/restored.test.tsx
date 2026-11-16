import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { Banner, Consequence, FixHead, FlowSteps, MoreDetail } from "../parts";
import { WorkQueue } from "../Queue";
import { WorkRequests } from "../Requests";
import { WorkProcessAnalytics } from "../ProcessAnalytics";
import { WorkAttention } from "../Attention";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Restored page parts (next)", () => {
  it("renders the banner, lede, steps, consequence and detail", () => {
    render(
      <>
        <Banner eyebrow="Eyebrow" headline="Headline" why="Why" figs={[{ label: "Open", value: "3", note: "Note" }]} action={<button>Go</button>} testId="b" label="Banner" />
        <FixHead lede="Lede" means={[["Open", "Still open"]]} />
        <FlowSteps label="Steps" current={1} steps={[{ label: "One" }, { label: "Two", count: "4", hint: "Hint" }]} />
        <Consequence>Nothing changes</Consequence>
        <MoreDetail title="More"><p>Inside</p></MoreDetail>
      </>,
    );
    const b = screen.getByTestId("b");
    expect(within(b).getByText("Headline")).toBeTruthy();
    expect(within(b).getByText("Note")).toBeTruthy();
    expect(screen.getByTestId("lede").textContent).toBe("Lede");
    expect(within(screen.getByTestId("means")).getByText("Still open")).toBeTruthy();
    expect(screen.getByTestId("flow-steps").textContent).toContain("Two");
    expect(screen.getByTestId("consequence").textContent).toBe("Nothing changes");
    expect(within(screen.getByTestId("more-detail")).getByText("Inside")).toBeTruthy();
  });
});

describe("Work queue restored functions (next)", () => {
  it("shows the banner with one primary action and the consequence", async () => {
    setUrl("/work?fixture=1");
    renderWithQuery(<ToastProvider><WorkQueue /></ToastProvider>);
    expect(await screen.findByTestId("queue-banner")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId("queue-primary").length).toBe(1));
    expect(screen.getAllByTestId("consequence").length).toBeGreaterThan(0);
  });

  it("switches density and grouping through the address", async () => {
    setUrl("/work?fixture=1");
    renderWithQuery(<ToastProvider><WorkQueue /></ToastProvider>);
    await screen.findByTestId("work-queue");
    const density = screen.getByRole("radiogroup", { name: "Row density" });
    fireEvent.click(within(density).getByRole("radio", { name: "Comfortable" }));
    await waitFor(() => expect(getUrl()).toContain("density="));
    const group = screen.getByRole("radiogroup", { name: "Group the list" });
    fireEvent.click(within(group).getByRole("radio", { name: "By rule" }));
    await waitFor(() => expect(getUrl()).toContain("group="));
  });

  it("saves the fix sheet once for ?export=1 and drops the param", async () => {
    setUrl("/work?fixture=1&export=1");
    renderWithQuery(<ToastProvider><WorkQueue /></ToastProvider>);
    await screen.findByTestId("work-queue");
    await waitFor(() => expect(getUrl()).not.toContain("export=1"));
  });
});

describe("Requests, process analytics and action centre heads (next)", () => {
  it("requests shows its banner, primary action and steps", async () => {
    setUrl("/requests?fixture=1");
    renderWithQuery(<ToastProvider><WorkRequests /></ToastProvider>);
    expect(await screen.findByTestId("requests-banner")).toBeTruthy();
    expect(screen.getByTestId("flow-steps")).toBeTruthy();
  });

  it("process analytics shows its steps and the created series", async () => {
    setUrl("/requests/analytics?fixture=1");
    renderWithQuery(<ToastProvider><WorkProcessAnalytics /></ToastProvider>);
    expect(await screen.findByTestId("flow-steps")).toBeTruthy();
    expect(await screen.findByTestId("pa-created-trend")).toBeTruthy();
  });

  it("action centre shows the banner, steps and consequence", async () => {
    setUrl("/work?fixture=1");
    renderWithQuery(<WorkAttention />);
    expect(await screen.findByTestId("attention-banner")).toBeTruthy();
    expect(screen.getByTestId("flow-steps")).toBeTruthy();
    expect(screen.getByTestId("consequence")).toBeTruthy();
  });
});
