import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { CatalogueScreen } from "./CatalogueScreen";
import { GlossaryScreen } from "./GlossaryScreen";
import { IssuesScreen } from "./IssuesScreen";
import { LineageScreen } from "./LineageScreen";
import { LinksScreen } from "./LinksScreen";
import { MiningScreen } from "./MiningScreen";
import { ProcessesScreen } from "./ProcessesScreen";
import { ReferenceScreen } from "./ReferenceScreen";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/mdm/catalogue?fixture=1");
});
afterEach(() => undo());

const screens: [string, ReactElement][] = [
  ["Catalogue", <CatalogueScreen key="c" />],
  ["Glossary", <GlossaryScreen key="g" />],
  ["Record issues", <IssuesScreen key="i" />],
  ["Lineage", <LineageScreen key="l" />],
  ["Process discovery", <ProcessesScreen key="p" />],
  ["Links", <LinksScreen key="k" />],
  ["Data mining", <MiningScreen key="m" />],
  ["Reference data", <ReferenceScreen key="r" />],
];

describe("master data catalogue screens", () => {
  it.each(screens)("%s renders its title in fixture mode", async (title, el) => {
    renderWithQuery(<AletheiaProvider>{el}</AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });
});
