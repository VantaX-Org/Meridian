import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { Forecast } from "./Forecast";
import { InsightsScreen } from "./InsightsScreen";
import { Monitor } from "./Monitor";
import { ScoreLens } from "./ScoreLens";
import { Value } from "./Value";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/insights?fixture=1");
});
afterEach(() => undo());

const wrap = (node: React.ReactNode) => <AletheiaProvider>{node}</AletheiaProvider>;
const screens: [string, React.ReactNode, string][] = [
  ["Insights", <InsightsScreen key="i" />, "Insights"],
  ["Score lens", <ScoreLens key="s" />, "Score lens"],
  ["Forecast", <Forecast key="f" />, "Forecast"],
  ["Value", <Value key="v" />, "Value"],
  ["Monitor", <Monitor key="m" />, "Monitor"],
  ["Cost and owners", <InsightsScreen key="c" set="money" />, "Cost and owners"],
  ["Controls", <Monitor key="k" set="controls" />, "Controls"],
];

describe("insight and monitor screens in fixture mode", () => {
  it.each(screens)("%s shows its title and no middle dot", async (_n, node, title) => {
    const { container } = renderWithQuery(wrap(node));
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(container.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});

describe("forecast engine cards", () => {
  it("shows the foresight band, go-live line and the reason ranking with evidence", async () => {
    renderWithQuery(wrap(<Forecast />));
    const fore = await screen.findByTestId("foresight", {}, { timeout: 5000 });
    expect(fore).toBeTruthy();
    expect(await screen.findByTestId("foresight-evidence")).toBeTruthy();
    const reason = await screen.findByTestId("reason", {}, { timeout: 5000 });
    expect(reason).toBeTruthy();
    expect(await screen.findByTestId("reason-risk-evidence")).toBeTruthy();
  });

  it("names each object in the picker instead of showing its module id", async () => {
    renderWithQuery(wrap(<Forecast />));
    const pick = (await screen.findByRole("combobox", { name: "Object" }, { timeout: 5000 })) as HTMLSelectElement;
    const labels = Array.from(pick.options).map((o) => o.textContent ?? "");
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toMatch(/_/);
  });
});

describe("monitor after a clean", () => {
  it("lists each system since its last clean with the rules that got worse", async () => {
    window.history.replaceState(null, "", "/insights/monitor?fixture=1&view=after-clean");
    renderWithQuery(wrap(<Monitor />));
    const box = await screen.findByTestId("since-clean", {}, { timeout: 5000 });
    expect(box.textContent).toContain("ECC production");
    expect(box.textContent).toContain("MM142");
    expect(box.textContent).toContain("B-236");
    expect(screen.getAllByRole("table", { name: "Rules that got worse" }).length).toBeGreaterThan(0);
  });
});

describe("no insight screen has more than five views", () => {
  it.each([
    ["Insights", <InsightsScreen key="i" />],
    ["Cost and owners", <InsightsScreen key="c" set="money" />],
    ["Monitor", <Monitor key="m" />],
    ["Controls", <Monitor key="k" set="controls" />],
  ])("%s keeps its tabs to five", async (_n, node) => {
    renderWithQuery(wrap(node));
    await screen.findByRole("tablist");
    const n = screen.getAllByRole("tab").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
  });
});

describe("old monitor links", () => {
  it("send a controls view on to the controls screen", async () => {
    const { replace } = await import("@/ui/testing/nav-store");
    window.history.replaceState(null, "", "/monitor?fixture=1&open=schedule");
    renderWithQuery(wrap(<Monitor />));
    await screen.findByRole("heading", { level: 1, name: "Monitor" });
    expect(replace).toHaveBeenCalledWith("/monitor/controls?view=schedule");
  });
});

describe("insight feedback", () => {
  it("saves a vote once and thanks the user", async () => {
    renderWithQuery(<AletheiaProvider><ToastHost><InsightsScreen /></ToastHost></AletheiaProvider>);
    const yes = (await screen.findByRole("button", { name: "Yes" }, { timeout: 5000 })) as HTMLButtonElement;
    fireEvent.click(yes);
    expect(await screen.findByText("Thanks, your feedback is saved.")).toBeTruthy();
    expect(yes.disabled).toBe(true);
  });
});

describe("insight finding links", () => {
  it("open the object on a real /o/{system}/{module-slug} route", async () => {
    renderWithQuery(wrap(<InsightsScreen />));
    const links = await screen.findAllByRole("link", { name: "Open the object" }, { timeout: 5000 });
    for (const a of links) expect(a.getAttribute("href")).toMatch(/^\/o\/_\/[a-z0-9-]+$/);
  });
});
