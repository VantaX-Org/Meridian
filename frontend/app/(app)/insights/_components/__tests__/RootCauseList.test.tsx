// A root cause's weight is failing records times a severity weight, never a change in the score (0 to 100).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RootCauseList } from "../RunAnalyses";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

describe("RootCauseList", () => {
  it("names the weight in its own units, not as an impact on the score", () => {
    render(<RootCauseList empty="None" run="v1" clusters={[{
      key: "material_master:unattributed", kind: "unattributed", module: "material_master", table: null, field: null,
      rules: ["DDIC-MARA-TYPE", "MM045"], dimension: "validity", severity: "high", records: 24576, records_estimated: true,
      impact: 98884, auto_fix_pct: 0, origin: { status: "not_computed", top: null, share: null },
    }]} />);
    expect(screen.queryByText(/Impact on score/)).toBeNull();
    expect(screen.getByText(/98,884 weighted failures \(failing records × severity weight/)).toBeInTheDocument();
  });
});
