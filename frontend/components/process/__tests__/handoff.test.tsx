// "Hand to a steward": process owners (handoff_rule, no `assign`) hand one blocking rule to someone who can fix it.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as stewardshipApi from "@/lib/api/stewardship";
import { LEGACY_ACTION_MAP, requestTargetFor } from "@/lib/rbac";
import { dateInDays, HandToSteward } from "../handoff";

const h = vi.hoisted(() => ({ actions: new Set<string>() }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (a: string) => h.actions.has(a) }) }));

const TARGET = { checkId: "PO-12", module: "mm_purchasing", versionId: "v1", process: "Procure to pay", field: "EKKO-LIFNR" };

beforeEach(() => {
  vi.restoreAllMocks();
  h.actions = new Set(["view", "handoff_rule"]);
  vi.spyOn(stewardshipApi, "getHandoffStewards").mockResolvedValue([
    { id: "u-ana", name: "Ana Silva", email: "ana@example.test", role: "data_steward" },
  ]);
});

describe("HandToSteward", () => {
  it("renders nothing without handoff_rule", () => {
    h.actions = new Set(["view", "run_process_discovery"]);
    const { container } = renderWithQuery(<HandToSteward target={TARGET} />);
    expect(container.textContent).toBe("");
  });

  it("hands the rule to the chosen steward with a note and due date", async () => {
    const send = vi.spyOn(stewardshipApi, "handoffRule").mockResolvedValue({ task_id: "t1", exception_id: "e1", assigned_to: "u-ana", due_at: "x" });
    const user = userEvent.setup();
    renderWithQuery(<HandToSteward target={TARGET} />);
    await user.click(screen.getByRole("button", { name: "Hand PO-12 to a steward" }));
    const go = screen.getByRole("button", { name: "Hand over" });
    expect(go).toBeDisabled();
    await user.click(await screen.findByRole("combobox", { name: "Steward" }));
    await user.click(await screen.findByRole("option", { name: "Ana Silva, Data steward" }));
    await user.type(screen.getByRole("textbox", { name: "Note" }), "Vendor blank on 40 POs");
    expect(go).toBeEnabled();
    await user.click(go);
    await waitFor(() => expect(send).toHaveBeenCalledWith({
      check_id: "PO-12", module: "mm_purchasing", assignee_id: "u-ana", note: "Vendor blank on 40 POs",
      due_date: dateInDays(7), version_id: "v1", finding_id: undefined, process: "Procure to pay", field: "EKKO-LIFNR",
    }));
    expect(await screen.findByText("Handed to Ana Silva")).toBeInTheDocument();
  });

  it("says so when no one can fix yet", async () => {
    vi.spyOn(stewardshipApi, "getHandoffStewards").mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithQuery(<HandToSteward target={TARGET} />);
    await user.click(screen.getByRole("button", { name: "Hand PO-12 to a steward" }));
    expect(await screen.findByText("No one can fix data yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hand over" })).toBeDisabled();
  });

  it("maps handoff_rule to creating a stewardship task, not assigning", () => {
    expect(LEGACY_ACTION_MAP.handoff_rule).toEqual([["stewardship", "create"]]);
    expect(requestTargetFor({ resource: null, action: "handoff_rule" })).toEqual({ resource: "stewardship", action: "create" });
  });

  it("dates the default due date a week out", () => {
    expect(dateInDays(7, new Date(Date.UTC(2026, 9, 26, 12)))).toBe("2026-11-02");
  });

  it("counts days from the UTC date the API compares against, not the local date", () => {
    // 23:30 on 26 October in UTC-8 is already 27 October in UTC: today's minimum is the 27th.
    const lateEveningWestOfUtc = new Date(Date.UTC(2026, 9, 27, 7, 30));
    expect(dateInDays(0, lateEveningWestOfUtc)).toBe("2026-10-27");
    // 08:00 on 27 October in UTC+10 is still 26 October in UTC.
    expect(dateInDays(0, new Date(Date.UTC(2026, 9, 26, 22)))).toBe("2026-10-26");
    expect(dateInDays(7, new Date(Date.UTC(2026, 11, 28, 23, 59)))).toBe("2027-01-04");
  });
});
