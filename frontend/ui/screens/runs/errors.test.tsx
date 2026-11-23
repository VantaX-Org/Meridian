import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AletheiaProvider } from "@/ui/kit";
import { CompareBoard } from "./CompareBoard";
import { HistoryTab } from "@/ui/screens/rules/RuleTabs";
import { LibraryRuleSheet } from "@/ui/screens/rules/RuleSheet";
import { Runs as ObjectRuns } from "@/ui/screens/object-tabs/Runs";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const refetch = vi.fn();
const failed = { isLoading: false, isError: true, data: undefined, refetch };
vi.mock("@/lib/api/next/runs", () => ({ useMultiCompare: () => failed }));
vi.mock("@/lib/v2/object-queries", () => ({ useRuleHistory: () => failed, useRuleFailuresBy: () => failed }));
vi.mock("@/ui/screens/rules/queries", () => ({ useRuleLibrary: () => failed, useAct: () => ({ mutate: vi.fn() }), useRuleReads: () => failed }));

const retry = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalled();
  refetch.mockClear();
};

describe("a failed request shows an error with retry, not an empty screen", () => {
  it("compare board", async () => {
    render(<AletheiaProvider><CompareBoard a="a" b="b" module="material_master" /></AletheiaProvider>);
    await retry();
  });
  it("rule history", async () => {
    render(<HistoryTab id="MM142" />);
    await retry();
  });
  it("library rule sheet", async () => {
    render(<AletheiaProvider><LibraryRuleSheet arg={{ id: "MM142" }} /></AletheiaProvider>);
    await retry();
  });
  it("object runs tab", async () => {
    const o = { heads: [], runsLoading: false, runsError: true, refetchRuns: refetch, label: "Material", runId: null } as unknown as ObjectRun;
    render(<AletheiaProvider><ObjectRuns o={o} system="s" module="material_master" /></AletheiaProvider>);
    await retry();
  });
});
