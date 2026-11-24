import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { Team } from "./Team";
import { getTeamWorkload, getTeams, getTriageQueue } from "@/lib/api/v2/triage";
import { resetTriageFixture } from "@/lib/api/v2/fixtures/triage";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  resetTriageFixture();
  window.history.replaceState(null, "", "/people/team?fixture=1");
});
afterEach(() => undo());

const render = () => renderWithQuery(<AletheiaProvider><Team /></AletheiaProvider>);
const teamItems = async () => {
  const q = await getTriageQueue("team:tm-mdm", false);
  return [...q.overdue.items, ...q.due_today.items, ...q.later.items];
};

describe("My team", () => {
  it("shows each person's workload, lead first", async () => {
    render();
    const table = await screen.findByRole("group", { name: "People on the team" }, { timeout: 5000 });
    const rows = within(table).getAllByRole("row").slice(1);
    const load = await getTeamWorkload("tm-mdm");
    expect(rows).toHaveLength(load.length);
    expect(within(rows[0]).getByText("A. Naidoo")).toBeTruthy();
    expect(within(rows[0]).getByText("Lead")).toBeTruthy();
    // the lead has no Remove button; members do
    expect(within(rows[0]).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(within(table).getByRole("button", { name: "Remove P. Khumalo" })).toBeTruthy();
  });

  it("adds and removes a member", async () => {
    render();
    const add = await screen.findByRole("combobox", { name: "Add a person" }, { timeout: 5000 });
    fireEvent.change(add, { target: { value: "u-tm" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to the team" }));
    await waitFor(async () => expect((await getTeams()).find((x) => x.id === "tm-mdm")?.member_ids).toContain("u-tm"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove P. Khumalo" }));
    await waitFor(async () => expect((await getTeams()).find((x) => x.id === "tm-mdm")?.member_ids).not.toContain("u-pk"));
  });

  it("hands picked work to one member, then shares the rest out across the team", async () => {
    render();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pick iss-101" }, { timeout: 5000 }));
    fireEvent.change(screen.getByRole("combobox", { name: "Give to" }), { target: { value: "u-pk" } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over 1 items" }));
    await screen.findByText("1 items assigned to P. Khumalo.", { selector: "p" });
    expect(screen.queryByRole("checkbox", { name: "Pick iss-101" })).toBeNull();
    expect((await teamItems()).find((i) => i.id === "iss-101")?.assigned_to).toBe("u-pk");

    fireEvent.click(screen.getByRole("checkbox", { name: "Pick q-202" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Give to" }), { target: { value: "__team__" } });
    fireEvent.click(screen.getByRole("button", { name: "Hand over 1 items" }));
    await screen.findByText("1 items shared out across Master data stewards.", { selector: "p" });
    const q202 = (await teamItems()).find((i) => i.id === "q-202");
    expect(q202?.assigned_team_id).toBe("tm-mdm");
    expect(["u-an", "u-me", "u-pk"]).toContain(q202?.assigned_to);
    expect(screen.getByRole("button", { name: "Hand over 0 items" })).toHaveProperty("disabled", true);
  });
});
