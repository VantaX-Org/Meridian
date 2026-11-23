import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { getAssignRules, getTeams, getTriageSettings } from "@/lib/api/v2/triage";
import { getEscalationChain } from "@/lib/api/v2/roles";
import { resetTriageFixture } from "@/lib/api/v2/fixtures/triage";
import { resetApprovalsFixture } from "@/lib/api/v2/fixtures/approvals";
import { resetRolesFixture } from "@/lib/api/v2/fixtures/roles";
import { Triage } from "./Triage";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/admin?fixture=1"); resetTriageFixture(); resetApprovalsFixture(); resetRolesFixture(); });
afterEach(() => undo());

const mount = () => renderWithQuery(<AletheiaProvider><ToastHost><Triage /></ToastHost></AletheiaProvider>);

describe("triage configuration", () => {
  it("renames a team", async () => {
    mount();
    const [first] = await getTeams();
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    fireEvent.change(await screen.findByLabelText(/^Team name/), { target: { value: "Renamed team" } });
    fireEvent.click(screen.getByRole("button", { name: "Save team" }));
    await waitFor(async () => expect((await getTeams()).find((x) => x.id === first.id)?.name).toBe("Renamed team"));
  });

  it("adds a rule in three steps", async () => {
    mount();
    const before = (await getAssignRules()).length;
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    fireEvent.change(await screen.findByLabelText(/^Rule name/), { target: { value: "Crit to team" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(screen.getByLabelText(/^Assign to/), { target: { value: "team" } });
    fireEvent.change(screen.getByLabelText(/^Team$/), { target: { value: (await getTeams())[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Crit to team/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Add rule" }).at(-1)!);
    await waitFor(async () => expect((await getAssignRules()).length).toBe(before + 1));
  });

  it("asks before removing a team", async () => {
    mount();
    const before = (await getTeams()).length;
    fireEvent.click((await screen.findAllByRole("button", { name: "Remove" }))[0]);
    expect(await screen.findByText(/Rules that assign to this team/)).toBeTruthy();
    expect((await getTeams()).length).toBe(before);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).at(-1)!);
    await waitFor(async () => expect((await getTeams()).length).toBe(before - 1));
  });

  it("saves the escalation chain and the fallback owner", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add level" }));
    fireEvent.change(screen.getByLabelText(/^Level 2 after/), { target: { value: "480" } });
    fireEvent.click(screen.getByRole("button", { name: "Save escalation" }));
    await waitFor(async () => expect((await getEscalationChain()).steps.map((s) => s.after_minutes)).toEqual([240, 480]));
    fireEvent.change(await screen.findByLabelText(/^Fallback owner/), { target: { value: "u-an" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" }).at(-1)!);
    await waitFor(async () => expect((await getTriageSettings()).fallback_user_id).toBe("u-an"));
  });
});
