import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/rules";
import * as authoring from "@/lib/api/rule-authoring";
import type { RuleVersion } from "@/lib/api/rules";
import { RuleVersions } from "../rule-versions";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const V = (version: number, state: string): RuleVersion => ({
  rule_id: "AP001", version, body: {}, state, note: null, created_by: "ana", approved_by: null, approved_at: null,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
});

beforeEach(() => vi.restoreAllMocks());

describe("RuleVersions", () => {
  it("offers only the moves the lifecycle allows and calls the transition endpoint", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(2, "in_review")] });
    const move = vi.spyOn(authoring, "transitionRuleVersion").mockResolvedValue(V(2, "active"));
    renderWithQuery(<RuleVersions ruleId="AP001" />);
    await userEvent.click(await screen.findByRole("button", { name: "Transition" }));
    expect(await screen.findByRole("menuitem", { name: "Send back to draft" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Retire version" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Approve and activate" }));
    await waitFor(() => expect(move).toHaveBeenCalledWith("AP001", 2, { to: "active" }));
  });

  it("retiring goes through a confirm dialog", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(1, "active")] });
    const move = vi.spyOn(authoring, "transitionRuleVersion").mockResolvedValue(V(1, "retired"));
    renderWithQuery(<RuleVersions ruleId="AP001" />);
    await userEvent.click(await screen.findByRole("button", { name: "Transition" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Retire version" }));
    expect(move).not.toHaveBeenCalled();
    const confirm = (await screen.findAllByRole("button", { name: "Retire version" })).pop() as HTMLElement;
    await userEvent.click(confirm);
    await waitFor(() => expect(move).toHaveBeenCalledWith("AP001", 1, { to: "retired" }));
  });

  it("shows a retired version without a menu", async () => {
    vi.spyOn(api, "getRuleVersions").mockResolvedValue({ rule_id: "AP001", shipped: null, versions: [V(1, "retired")] });
    renderWithQuery(<RuleVersions ruleId="AP001" />);
    expect(await screen.findByText("v1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transition" })).toBeNull();
  });
});
