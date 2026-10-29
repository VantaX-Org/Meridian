import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/learnedRules";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import type { LearnedRule } from "@/lib/api/learnedRules";
import LearnedRulesPage from "../page";

const nav = vi.hoisted(() => ({ params: new URLSearchParams("") }));
vi.mock("next/navigation", () => ({ useSearchParams: () => nav.params, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/rules/learned" }));
const perms = vi.hoisted(() => ({ granted: null as Set<string> | null }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => perms.granted === null || perms.granted.has(a) }) }));
const access = vi.hoisted(() => ({ requestAccess: null as null | ((t: unknown) => void) }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissionsContext: () => (access.requestAccess ? { loading: false, can: () => true, has: () => true, requestAccess: access.requestAccess } : null),
}));
beforeEach(() => { perms.granted = null; access.requestAccess = null; });

const RULE: LearnedRule = {
  id: "p1", version_id: "v1", module: "material_master", kind: "dependency", table_name: "MARC",
  determinant: "MARA.MTART", field: "MARC.BESKZ", confidence: 0.991, support_rows: 120000, violations: 1080,
  sample_keys: ["MATNR=000000000000000042"], status: "pending", rule_id: null, decided_by: null, decided_at: null,
  updated_at: "2026-10-10T00:00:00Z",
  body: { check_class: "dependency_check", allowed: { ROH: ["F"] }, message: "MARC.BESKZ does not follow MARA.MTART" },
};

describe("learned rules page", () => {
  it("mines the latest run when Mine now is pressed", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v9", status: "complete" } as Version] });
    const mine = vi.spyOn(api, "mineLearnedRules").mockResolvedValue({ queued: true });
    renderWithQuery(<LearnedRulesPage />);
    const button = await screen.findByRole("button", { name: "Mine now" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(mine).toHaveBeenCalledWith("v9"));
  });

  it("shows a decided proposal's rule id in mono and a rejected one as a plain label", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [
      { ...RULE, status: "approved", rule_id: "LR-000001" },
      { ...RULE, id: "p2", field: "MARC.DISMM", status: "rejected", rule_id: null },
    ] });
    renderWithQuery(<LearnedRulesPage />);
    expect((await screen.findByText("LR-000001")).closest("code, .m-mono, [class*='mono']")).not.toBeNull();
    const rejected = screen.getByText("Rejected");
    expect(rejected.closest("code, .m-mono, [class*='mono']")).toBeNull();
    expect(screen.queryByText("rejected")).toBeNull();
  });

  it("lists a proposal and approves it", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    const approve = vi.spyOn(api, "approveLearnedRule").mockResolvedValue({ id: "p1", status: "approved", rule_id: "LR-000001" });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    expect(screen.getByText("99.1%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("p1", "medium"));
  });

  it("approves at the severity chosen in the filter bar", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    const approve = vi.spyOn(api, "approveLearnedRule").mockResolvedValue({ id: "p1", status: "approved", rule_id: "LR-000002" });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Approve as" }));
    await userEvent.click(await screen.findByRole("option", { name: "High" }));
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("p1", "high"));
  });

  it.each([["approve"], ["review_ai_rules"]])("shows Reject beside Approve to a checker with %s alone, and rejects", async (perm) => {
    perms.granted = new Set(["view", perm]);
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    const reject = vi.spyOn(api, "rejectLearnedRule").mockResolvedValue({ id: "p1", status: "rejected" });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(reject).toHaveBeenCalled());
    expect(reject.mock.calls[0][0]).toBe("p1");
  });

  it("offers a rule writer (manage_rules alone) Reject but not Approve", async () => {
    perms.granted = new Set(["view", "manage_rules"]);
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("offers a viewer neither decision", async () => {
    perms.granted = new Set(["view"]);
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    // The Action column would be empty on every row, so it is left out.
    expect(screen.queryByRole("columnheader", { name: "Action" })).toBeNull();
  });

  it("tells a viewer why, with Request access for the review permission", async () => {
    perms.granted = new Set(["view"]);
    const requestAccess = vi.fn();
    access.requestAccess = requestAccess;
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText(/you can read the proposals but not decide on them/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(requestAccess).toHaveBeenCalledWith({ resource: "rules", action: "approve" });
  });

  it("keeps the Action column and shows no notice for someone who can decide", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    renderWithQuery(<LearnedRulesPage />);
    await screen.findByText("MARC.BESKZ");
    expect(screen.getByRole("columnheader", { name: "Action" })).toBeInTheDocument();
    expect(screen.queryByText(/you can read the proposals but not decide on them/)).toBeNull();
  });

  it("explains an empty proposal list and offers to mine again", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v9", status: "complete" } as Version] });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("No proposals waiting")).toBeInTheDocument();
    expect(await screen.findByText(/Mine now to look again/)).toBeInTheDocument();
  });

  it("shows an error state with retry", async () => {
    const get = vi.spyOn(api, "getLearnedRules").mockRejectedValue(new Error("boom"));
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    get.mockResolvedValueOnce({ items: [RULE] });
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
  });
});
