// frontend/app/(app)/objects/__tests__/capped-ranking.test.tsx
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as objectsApi from "@/lib/api/v1/objects";
import * as ownersApi from "@/lib/api/owners";
import * as usersApi from "@/lib/api/users";
import { COUNT_DEFS } from "@/lib/counts";
import { cappedScore } from "../_cap";
import ObjectsPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("run=v1"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const ledger = () => within(screen.getByRole("grid"));
const mk = (module: string, label: string, over: Partial<objectsApi.ObjectSummary> = {}): objectsApi.ObjectSummary => ({
  module, label, composite_score: 70, readiness: "fail", failing_checks: 3, affected_records: 120, critical_checks: 2, high_checks: 0, ...over,
});

describe("cappedScore", () => {
  it("shows the uncapped score with the cap as the tick when the API says it is capped", () => {
    expect(cappedScore(mk("a", "A", { capped: true, raw_score: 83.5 }))).toEqual({ shown: 83.5, cap: 70 });
  });
  it("keeps the capped figure when the uncapped one is not known", () => {
    expect(cappedScore(mk("a", "A", { capped: true }))).toEqual({ shown: 70, cap: 70 });
  });
  it("reads a backend that does not say from the row: a critical rule and a score at a cap value", () => {
    expect(cappedScore(mk("a", "A"))).toEqual({ shown: 70, cap: 70 });
    expect(cappedScore(mk("a", "A", { composite_score: 85 }))).toEqual({ shown: 85, cap: 85 });
    expect(cappedScore(mk("a", "A", { critical_checks: 0 }))).toEqual({ shown: 70 });
    expect(cappedScore(mk("a", "A", { capped: false }))).toEqual({ shown: 70 });
  });
  it("is null without a score", () => {
    expect(cappedScore(mk("a", "A", { composite_score: null }))).toBeNull();
  });
});

describe("ObjectsPage, capped scores and columns", () => {
  it("draws each capped object at its uncapped score, says Capped at 70, and names the all-rules total", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v1",
      objects: [mk("a", "AAA", { capped: true, raw_score: 83.5, blocking_rule_id: "MM045" }), mk("b", "BBB", { capped: true, raw_score: 78.2 })],
    });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("83.5")).toBeInTheDocument());
    expect(ledger().getByText("78.2")).toBeInTheDocument();
    expect(ledger().getAllByText("Capped at 70")).toHaveLength(2);
    const headers = ledger().getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toContain(`${COUNT_DEFS.rule_failures.label} (all rules)`);
    // the total no longer sits beside the blocking rule
    expect(headers.indexOf("Blocking rule") - headers.indexOf(`${COUNT_DEFS.rule_failures.label} (all rules)`)).toBeGreaterThan(1);
    expect(screen.getByTitle(COUNT_DEFS.rule_failures.hint)).toBeInTheDocument();
  });

  it("hides the Owner column when nobody owns an object, and offers one Assign owners prompt to those who may", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockResolvedValue([]);
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA"), mk("b", "BBB")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("AAA")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("assign-owners")).toBeInTheDocument());
    expect(ledger().queryByRole("columnheader", { name: "Owner" })).toBeNull();
    expect(ledger().queryByText("Not set")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Assign owners" })).toHaveLength(1);
  });

  it("shows no Assign owners prompt to someone who may not assign", async () => {
    vi.spyOn(ownersApi, "getOwners").mockResolvedValue([]);
    vi.spyOn(usersApi, "getAssignableUsers").mockRejectedValue(new Error("forbidden"));
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v1", objects: [mk("a", "AAA")] });
    renderWithQuery(<ObjectsPage />);
    await waitFor(() => expect(ledger().getByText("AAA")).toBeInTheDocument());
    expect(screen.queryByTestId("assign-owners")).toBeNull();
  });
});
