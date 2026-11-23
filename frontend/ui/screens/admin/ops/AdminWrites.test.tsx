import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { getRunSchedule, listApiKeys, listFieldMappings, listUsers } from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures/admin";
import { Mappings } from "./Mappings";
import { Schedules } from "./Schedules";
import { ApiKeys } from "../access/ApiKeys";
import { Users } from "../access/Users";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/admin?fixture=1"); resetAdminFixture(); });
afterEach(() => undo());

const wrap = (n: React.ReactNode) => renderWithQuery(<AletheiaProvider><ToastHost>{n}</ToastHost></AletheiaProvider>);

describe("admin writes", () => {
  it("sets who a person reports to", async () => {
    const { users } = await listUsers();
    const [a, b] = users;
    wrap(<Users />);
    fireEvent.click(await screen.findByRole("button", { name: a.name }));
    fireEvent.change(await screen.findByLabelText(/^Manager/), { target: { value: b.id } });
    fireEvent.click(screen.getByRole("button", { name: "Save manager" }));
    await waitFor(async () => expect((await listUsers()).users.find((u) => u.id === a.id)?.manager_id).toBe(b.id));
  });

  it("edits an active API key", async () => {
    wrap(<ApiKeys />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    await screen.findByRole("dialog");
    fireEvent.change(screen.getAllByLabelText(/^Name/).at(-1)!, { target: { value: "Nightly export" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(async () => expect((await listApiKeys()).find((k) => k.id === "key-1")?.name).toBe("Nightly export"));
  });

  it("adds a field mapping", async () => {
    wrap(<Mappings />);
    fireEvent.change(await screen.findByLabelText(/^Standard field$/), { target: { value: "ZZ_TEST" } });
    fireEvent.change(screen.getAllByLabelText(/^Object$/).at(-1)!, { target: { value: "material_master" } });
    fireEvent.click(screen.getByRole("button", { name: "Add mapping" }));
    await waitFor(async () => expect((await listFieldMappings({ search: "ZZ_TEST" })).mappings.length).toBe(1));
  });

  it("edits a schedule and shows sync runs", async () => {
    wrap(<Schedules />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    await screen.findByRole("dialog");
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "Monday material run" } });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(async () => expect((await getRunSchedule("rs-1")).name).toBe("Monday material run"));
    fireEvent.change(screen.getAllByLabelText(/^System/).at(-1)!, { target: { value: "a1b2c3d4-0001-4000-8000-000000000001" } });
    expect(await screen.findByLabelText("Sync runs")).toBeTruthy();
  });
});
