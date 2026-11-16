import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Work } from "./Work";
import { Triage } from "./Triage";
import { Exceptions } from "./Exceptions";
import { WorkAnalytics } from "./WorkAnalytics";
import { DataRequests } from "./DataRequests";
import { Approvals } from "./Approvals";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); });
afterEach(() => undo());

const cases: [string, string, () => ReactElement][] = [
  ["Work", "/n/work", () => <Work />],
  ["Triage", "/n/work/triage", () => <Triage />],
  ["Exceptions", "/n/work/exceptions", () => <Exceptions />],
  ["Work analytics", "/n/work/analytics", () => <WorkAnalytics />],
  ["Data requests", "/n/work/requests", () => <DataRequests />],
  ["Approvals", "/n/approvals", () => <Approvals />],
];

describe("work screens in fixture mode", () => {
  it.each(cases)("%s shows its title and a data row", async (title, path, el) => {
    window.history.replaceState(null, "", `${path}?fixture=1`);
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close">{el()}</SheetHost></AletheiaProvider>);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect((await screen.findAllByRole("row", {}, { timeout: 5000 })).length).toBeGreaterThan(1);
  });
});
