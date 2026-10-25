// /rules/<check id>: every screen shows the check id, so the rule page resolves it to the rule.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "../../../../../__tests__/render";
import RulePage from "../page";
import { getRuleByCode } from "@/lib/api/rules";

const replace = vi.fn();
let params = { ruleId: "MM045" };
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/rules/MM045",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api/rules", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/rules")>("@/lib/api/rules");
  const rejected = Object.assign(new Error("Invalid rule ID"), { isAxiosError: true, response: { status: 400, data: { detail: "Invalid rule ID" } } });
  return { ...actual, getRuleByCode: vi.fn(), getRule: vi.fn().mockRejectedValue(rejected), getRuleHistory: vi.fn().mockResolvedValue({ runs: [] }) };
});

const detail = (rule_uuid: string | null) => ({
  id: "MM045", module: "material_master", category: null, field: "MAKT.MAKTX", check_class: "null_check", severity: "critical",
  dimension: "completeness", message: "Material description is missing", rule_uuid, enabled: true, source: null,
  latest_finding_id: null, latest_version_id: null,
}) as unknown as Awaited<ReturnType<typeof getRuleByCode>>;

beforeEach(() => { replace.mockClear(); params = { ruleId: "MM045" }; });

describe("rule page by check id", () => {
  it("opens the rule's own page", async () => {
    vi.mocked(getRuleByCode).mockResolvedValue(detail("0b6f3a5e-2c1d-4e8f-9a7b-1c2d3e4f5a6b"));
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/rules/0b6f3a5e-2c1d-4e8f-9a7b-1c2d3e4f5a6b"));
  });

  it("says when the rule has not run in this tenant", async () => {
    vi.mocked(getRuleByCode).mockResolvedValue(detail(null));
    renderWithQuery(<RulePage />);
    expect(await screen.findByText("MM045 has not run here yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the rules of this object" })).toHaveAttribute("href", "/rules?module=material_master");
  });
});
