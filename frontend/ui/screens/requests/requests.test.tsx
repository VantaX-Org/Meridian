import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { RequestAnalyticsScreen } from "./RequestAnalyticsScreen";
import { RequestNewScreen } from "./RequestNewScreen";
import { RequestScreen } from "./RequestScreen";
import { RequestsScreen } from "./RequestsScreen";
import { WorkflowsScreen } from "./WorkflowsScreen";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/requests?fixture=1");
});
afterEach(() => undo());

const screens: [string, ReactElement][] = [
  ["Change requests", <RequestsScreen key="a" />],
  ["New request", <RequestNewScreen key="b" />],
  ["Process analytics", <RequestAnalyticsScreen key="c" />],
  ["Workflows", <WorkflowsScreen key="d" />],
  ["New spare part: hydraulic seal kit", <RequestScreen key="e" id="CR-1001" />],
];

describe("change request screens", () => {
  it.each(screens)("%s renders its title in fixture mode", async (title, el) => {
    renderWithQuery(<AletheiaProvider>{el}</AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("lists fixture requests", async () => {
    renderWithQuery(<AletheiaProvider><RequestsScreen /></AletheiaProvider>);
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
  });
});
