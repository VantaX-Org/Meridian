import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/learnedRules";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import type { LearnedRule } from "@/lib/api/learnedRules";
import LearnedRulesPage from "../page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/rules/learned" }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

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

  it("lists a proposal and approves it", async () => {
    vi.spyOn(api, "getLearnedRules").mockResolvedValue({ items: [RULE] });
    const approve = vi.spyOn(api, "approveLearnedRule").mockResolvedValue({ id: "p1", status: "approved", rule_id: "LR-000001" });
    renderWithQuery(<LearnedRulesPage />);
    expect(await screen.findByText("MARC.BESKZ")).toBeInTheDocument();
    expect(screen.getByText("99.1%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith("p1", "medium"));
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
