import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { People } from "./People";
import { Stewardship } from "./Stewardship";
import { Contracts } from "./Contracts";
import { Digests } from "./Digests";
import { Assignments } from "./Assignments";
import { Share } from "./Share";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/people?fixture=1");
});
afterEach(() => undo());

const wrap = (el: ReactElement) => <AletheiaProvider>{el}</AletheiaProvider>;
const cases: [string, ReactElement, string][] = [
  ["People", <People key="p" />, "People"],
  ["Stewardship", <Stewardship key="s" />, "Stewardship"],
  ["Contracts", <Contracts key="c" />, "Data contracts"],
  ["Digests", <Digests key="d" />, "Digests"],
  ["Assignments", <Assignments key="a" />, "Assignments"],
];

describe("people and governance screens in fixture mode", () => {
  it.each(cases)("%s shows its title and real rows", async (_n, el, title) => {
    renderWithQuery(wrap(el));
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
  });

  it("Share resolves a link and offers the shared page", async () => {
    renderWithQuery(wrap(<Share token="demo" />));
    expect(await screen.findByRole("heading", { level: 1, name: "Shared with you" })).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Open the shared page" })).toBeTruthy();
  });
});
