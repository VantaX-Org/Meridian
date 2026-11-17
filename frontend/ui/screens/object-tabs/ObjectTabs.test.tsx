import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { Screen } from "./Screen";
import { cameBack, groupByTable } from "./Record";
import type { Tab } from "./TabFrame";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1");
});
afterEach(() => undo());

describe("pure helpers", () => {
  it("groupByTable splits TABLE.FIELD keys by table", () => {
    const g = groupByTable({ "MARA.MATNR": "1", "MARA.MTART": "ROH", "MARC.WERKS": "1000" });
    expect(g.map((x) => x.table).sort()).toEqual(["MARA", "MARC"]);
  });
  it("cameBack flags a failing run that follows a sent fix", () => {
    const back = cameBack(
      [{ run_id: "a", run_at: "2026-01-01", failing: true }, { run_id: "b", run_at: "2026-02-01", failing: false }, { run_id: "c", run_at: "2026-03-01", failing: true }],
      [{ at: "2026-01-15", kind: "fix_sent" }],
    );
    expect(back.has("c")).toBe(true);
    expect(back.has("a")).toBe(false);
  });
});

const TABS: [Tab, string][] = [
  ["records", "Records"], ["trend", "Trend"], ["runs", "Runs"], ["fixes", "Fixes"], ["rules", "Rules"], ["golden", "Golden records"],
  ["glossary", "Glossary"], ["lineage", "Lineage"], ["profile", "Profile"], ["readiness", "Readiness"], ["processes", "Processes"], ["design", "Process designer"],
];

describe("object sub-screens", () => {
  it.each(TABS)("%s renders its title in fixture mode", async (tab, title) => {
    renderWithQuery(
      <AletheiaProvider>
        <Screen tab={tab} system="ecc-production" module="material-master" />
        <AletheiaPanel labels={labels} />
      </AletheiaProvider>,
    );
    expect((await screen.findAllByRole("heading", { level: 1, name: title }, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
  it("record renders its title", async () => {
    renderWithQuery(<AletheiaProvider><Screen tab="record" system="ecc-production" module="material-master" recordKey="000000000000000001" /></AletheiaProvider>);
    expect((await screen.findAllByRole("heading", { level: 1, name: "Record" }, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});
