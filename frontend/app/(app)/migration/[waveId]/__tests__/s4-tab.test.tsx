import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as migrationApi from "@/lib/api/migration";
import * as remediationApi from "@/lib/api/remediation";
import * as rulesApi from "@/lib/api/rules";
import { S4Tab } from "../s4-tab";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/migration/w1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const READINESS: migrationApi.S4Readiness = {
  version_id: "v1", status: "red", ready: false, rules: 8, evaluated: 8, failing: 3, failing_records: 40, blocking_failing: 2, warning_failing: 1,
  areas: [
    {
      area: "business_partner", label: "Business Partner / CVI", simplification_item: "Business Partner Approach", rules: 5, evaluated: 5,
      failing: 2, failing_records: 30, blocking_failing: 2, warning_failing: 0, status: "red",
      checks: [
        { check_id: "S4-CVI-LFA1", module: "accounts_payable", impact: "blocking", status: "red", affected_count: 25, pass_rate: 90 },
        { check_id: "BP203", module: "business_partner", impact: "warning", status: "amber", affected_count: 5, pass_rate: 98 },
      ],
    },
    {
      area: "material", label: "Material master", simplification_item: null, rules: 3, evaluated: 3,
      failing: 0, failing_records: 0, blocking_failing: 0, warning_failing: 0, status: "green", checks: [],
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockReset();
  vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue(READINESS);
});

describe("S4Tab", () => {
  it("summarises readiness, blocking areas and failing records", async () => {
    renderWithQuery(<S4Tab versionId="v1" />);
    const summary = await screen.findByTestId("s4-summary");
    expect(within(summary).getByText("No-go")).toBeInTheDocument();
    expect(within(summary).getByText("Blocking areas").parentElement).toHaveTextContent("1");
    expect(within(summary).getByText("40")).toBeInTheDocument();
  });

  it("links each area to its findings (unfiltered when the area spans modules) and disables actions with nothing failing", async () => {
    renderWithQuery(<S4Tab versionId="v1" />);
    const links = await screen.findAllByRole("link", { name: "Open findings" });
    // The first area fails in accounts_payable and business_partner; a module filter would hide one of them.
    expect(links[0]).toHaveAttribute("href", "/runs/v1?tab=findings");
    const buttons = screen.getAllByRole("button", { name: "Create fix batch" });
    expect(buttons[1]).toBeDisabled();
  });

  it("drafts a fix batch from the area's worst failing check and opens it", async () => {
    const create = vi.spyOn(remediationApi, "createBatch").mockResolvedValue({ id: "b1", name: "x", status: "draft", item_count: 25 });
    renderWithQuery(<S4Tab versionId="v1" />);
    const buttons = await screen.findAllByRole("button", { name: "Create fix batch" });
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(create).toHaveBeenCalledWith("S/4 Business Partner / CVI: S4-CVI-LFA1", { check_id: "S4-CVI-LFA1", version_id: "v1" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/fix?tab=batches&batch=b1"));
  });

  it("opens an area with the remediation text of its failing checks", async () => {
    const byCode = vi.spyOn(rulesApi, "getRuleByCode").mockResolvedValue({
      message: "Vendor has no business partner", sap_impact: "The vendor cannot be converted", record_fix_template: "Create a BP for LFA1 {LIFNR}",
    } as rulesApi.RuleDetail);
    renderWithQuery(<S4Tab versionId="v1" />);
    await userEvent.click(await screen.findByText("Business Partner / CVI"));
    expect((await screen.findAllByText("The vendor cannot be converted")).length).toBe(2);
    expect(screen.getAllByText("Create a BP for LFA1 {LIFNR}").length).toBe(2);
    expect(byCode).toHaveBeenCalledWith("S4-CVI-LFA1", "accounts_payable");
    expect(byCode).toHaveBeenCalledWith("BP203", "business_partner");
  });

  it("says the areas are not evaluated, not zeros, when no check ran", async () => {
    vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({
      ...READINESS, evaluated: 0, failing: 0, failing_records: 0, blocking_failing: 0, warning_failing: 0,
      areas: READINESS.areas.map((a) => ({ ...a, evaluated: 0, failing: 0, failing_records: 0, blocking_failing: 0, status: "not_evaluated", checks: [] })),
    });
    renderWithQuery(<S4Tab versionId="v1" runAction={<button type="button">Run now</button>} />);
    expect(await screen.findByText("Not evaluated")).toBeInTheDocument();
    expect(screen.getByText(/run the wave/i)).toBeInTheDocument();
    expect(screen.queryByTestId("s4-summary")).toBeNull();
    expect(screen.queryByText("No-go")).toBeNull();
  });

  it("asks for a wave run first when there is no version, with the run action", async () => {
    const onRun = vi.fn();
    renderWithQuery(<S4Tab versionId={null} runAction={<button type="button" onClick={onRun}>Run now</button>} />);
    const empty = screen.getByText("Not run yet").closest("[data-state='empty']") as HTMLElement;
    expect(within(empty).getByText(/run this wave/i)).toBeInTheDocument();
    await userEvent.click(within(empty).getByRole("button", { name: "Run now" }));
    expect(onRun).toHaveBeenCalled();
  });
});
