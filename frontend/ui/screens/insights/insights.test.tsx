import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
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
];

describe("insight and monitor screens in fixture mode", () => {
  it.each(screens)("%s shows its title and no middle dot", async (_n, node, title) => {
    const { container } = renderWithQuery(wrap(node));
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(container.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});
