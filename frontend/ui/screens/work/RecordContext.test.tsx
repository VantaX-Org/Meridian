import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { AletheiaProvider, SheetHost } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import type { WorkRecordDetail } from "@/lib/api/work";
import { RecordDetail } from "./RecordDetail";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
const rec: WorkRecordDetail = {
  version_id: "v1", module: "employee_central", record_key: "EXTERNALCODE=KMT_BW", name: null, status: "to_fix",
  assigned_to: null, assignee_email: null, values: {}, events: [], can: { fix: true, sign_off: false, assign: false, comment: false },
  context: [{ field: "FO_LEGAL_ENTITY_LOCAL.COUNTRY", label: "Country", value: "BWA" }], country: "BWA",
  issues: [{ check_id: "EC1", severity: "high", dimension: null, message: "Currency is missing", field: "FO_LEGAL_ENTITY.CURRENCY",
    current_value: null, instruction: "Set the legal entity currency.", why_it_matters: null, sap_impact: null,
    suggestion: { value: "BWP", source: "rule", confidence: "high", why: "Country BWA uses BWP" },
    allowed_values: [{ value: "BWP", label: "Pula" }], status: "to_fix", issue_id: null, resolution: null, first_seen_at: null,
    reopened_count: 0, due_at: null, sla_state: null }],
};
vi.mock("@/lib/v2/work-queries", () => ({ useWorkRecord: () => ({ isLoading: false, isError: false, data: rec, refetch: vi.fn() }) }));

describe("record fix tab", () => {
  it("shows the country, context codes, how to fix, the suggestion basis and allowed values", () => {
    renderWithQuery(<AletheiaProvider><SheetHost sheets={SHEETS} closeLabel="Close"><RecordDetail module="employee_central" recordKey="EXTERNALCODE=KMT_BW" /></SheetHost></AletheiaProvider>);
    fireEvent.click(screen.getByRole("tab", { name: /Fix/ }));
    expect(screen.getByText(/Country: BWA/)).toBeTruthy();
    expect(screen.getByText(/How to fix: Set the legal entity currency\./)).toBeTruthy();
    expect(screen.getByText(/Basis: Country BWA uses BWP \(Confidence: high\)/)).toBeTruthy();
    expect(screen.getByText(/Allowed values: BWP Pula/)).toBeTruthy();
  });
});
