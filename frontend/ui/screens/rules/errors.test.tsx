import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AletheiaProvider } from "@/ui/kit";
import type { RuleScope } from "@/lib/api/v2/object";
import { RuleBoard } from "./RuleBoard";
import { RuleFix } from "./RuleFix";
import { RuleSheet } from "./RuleSheet";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

const refetch = vi.fn();
const failed = { isLoading: false, isError: true, data: undefined, refetch };
const ok = (data: unknown) => ({ isLoading: false, isError: false, data, refetch });

vi.mock("@/lib/v2/object-queries", () => ({
  useRuleScope: () => failed,
  useRuleHistory: () => ok([]),
  useRuleFailuresBy: () => failed,
  useConfigImpact: () => failed,
  useWorkGroups: () => ok([]),
  useStewards: () => failed,
}));
vi.mock("@/lib/v2/queries", () => ({ useObjectRules: () => failed, useReceipt: () => failed }));
vi.mock("@/lib/api/next/failing", () => ({ RECORDS_PAGE: 50, useFailingRecords: () => failed }));
vi.mock("@/ui/screens/rules/queries", () => ({
  useAct: () => ({ mutate: vi.fn(), isPending: false }),
  useRuleReads: () => failed,
  useFeedback: () => failed,
  useSuppressions: () => failed,
  useTuning: () => failed,
  useVersionDiff: () => failed,
}));

const scope = { check_id: "MM142", module: "material_master", definition: { params: {} }, objects: [{ module: "material_master", run_id: "r1" }], failing_records: 0, versions: [], tenant_rule: null } as unknown as RuleScope;

const retry = async () => {
  fireEvent.click((await screen.findAllByRole("button", { name: "Try again" }))[0]);
  expect(refetch).toHaveBeenCalled();
  refetch.mockClear();
};

describe("rule screens show a failed read with retry", () => {
  it("rule sheet", async () => {
    render(<AletheiaProvider><RuleSheet arg={{ id: "MM142" }} /></AletheiaProvider>);
    await retry();
  });
  it("rule board secondary reads and records", async () => {
    render(<AletheiaProvider><RuleBoard id="MM142" scope={scope} /></AletheiaProvider>);
    await retry();
  });
  it("rule fix secondary reads", async () => {
    render(<AletheiaProvider><RuleFix id="MM142" scope={scope} /></AletheiaProvider>);
    await retry();
  });
});
