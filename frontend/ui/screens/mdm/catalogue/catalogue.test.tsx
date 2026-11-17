import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { CatalogueScreen } from "./CatalogueScreen";
import { GlossaryScreen } from "./GlossaryScreen";
import { IssuesScreen } from "./IssuesScreen";
import { LineageScreen } from "./LineageScreen";
import { LinksScreen } from "./LinksScreen";
import { MiningScreen } from "./MiningScreen";
import { ProcessesScreen } from "./ProcessesScreen";
import { ReferenceScreen } from "./ReferenceScreen";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/mdm/catalogue?fixture=1");
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

describe("data mining anomaly to rule", () => {
  it("proposes a rule from an anomaly, shows its dry run and grounding, and approves it as a draft", async () => {
    renderWithQuery(<AletheiaProvider><MiningScreen /></AletheiaProvider>);
    fireEvent.click(await screen.findByRole("tab", { name: /Anomalies/ }));
    const buttons = await screen.findAllByRole("button", { name: "Propose a rule" });
    fireEvent.click(buttons[0]);
    const sheet = await screen.findByTestId("anomaly-proposal");
    expect(within(sheet).getByLabelText("Proposed rule").textContent).toContain("fail_when");
    expect(sheet.textContent).toContain("records would fail");
    expect(sheet.textContent).toContain("A rule template");
    const approve = within(sheet).getByRole("button", { name: "Approve as a draft" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    // The sheet closes only when the draft was saved.
    await waitFor(() => expect(screen.queryByTestId("anomaly-proposal")).toBeNull());
  });
});
