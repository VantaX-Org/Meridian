import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { rolesAudit } from "@/lib/api/v2/fixtures/roles";
import * as rolesApi from "@/lib/api/v2/roles";
import { v2Get } from "@/lib/api/v2/client";
import { WorkCanvas } from "../../screens/Work";
import { stubLayout } from "../layout-stub";
import { mount, norm, reset, visit } from "./helpers";

vi.mock("next/navigation", async () => (await import("../nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const RECORD = "material_master:MATNR=000000000000000100";
let undo: () => void = () => undefined;
beforeEach(() => {
  reset();
  undo = stubLayout();
});
afterEach(() => {
  undo();
  vi.restoreAllMocks();
});

describe("the data steward's jobs", () => {
  it("comments on a record and mentions a colleague by @handle", async () => {
    const add = vi.spyOn(rolesApi, "addComment");
    visit(`/work?open=${encodeURIComponent(`record:${RECORD}`)}`, "data_steward");
    mount();
    const comments = await screen.findByTestId("comments");
    expect(norm(comments)).toContain("Check the unit with purchasing before Friday");
    const box = within(comments).getByRole("textbox", { name: "Add a comment" });
    fireEvent.change(box, { target: { value: "Can you confirm, @t.mok" } });
    fireEvent.click(await within(comments).findByRole("button", { name: /T\. Mokoena/ }));
    expect((box as HTMLTextAreaElement).value).toBe("Can you confirm, @t.mokoena ");
    fireEvent.click(within(comments).getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(add).toHaveBeenCalledWith("record", RECORD, "Can you confirm, @t.mokoena", ["u-tm"]));
    await waitFor(() => expect(within(screen.getByTestId("comments")).getAllByTestId("comment")).toHaveLength(2));
  });

  it("watches a record from its inspector", async () => {
    visit(`/work?open=${encodeURIComponent(`record:${RECORD}`)}`, "data_steward");
    mount();
    const watch = await screen.findByTestId("watch");
    const btn = within(watch).getByRole("button", { name: "Watch" });
    await waitFor(() => expect(btn).toBeEnabled());
    fireEvent.click(btn);
    expect(await within(screen.getByTestId("watch")).findByRole("button", { name: "Watching" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is told to fix the upstream object first on the ledger of a dependent object", async () => {
    visit("/work?module=mm_purchasing", "data_steward");
    mount(<WorkCanvas />);
    expect(norm(await screen.findByTestId("fix-hint"))).toBe("Fix Material master first: 3,640 upstream failures. Records there fail before this object can pass.");
  });

  it("saves the ledger's columns as a view shared with everyone", async () => {
    visit("/work", "data_steward");
    mount(<WorkCanvas />);
    fireEvent.click(await screen.findByRole("button", { name: "Share and export Work" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Save these columns as a view…" }));
    const dialog = await screen.findByRole("dialog", { name: "Save these columns as a view" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Plant 3000 team" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Share with everyone/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(async () => {
      const got = await v2Get<{ views: { name: string; shared?: boolean }[] }>("/views", { route: "work" });
      expect(got.views.find((v) => v.name === "Plant 3000 team")?.shared).toBe(true);
    });
  });

  it("sets out of office with someone who covers", async () => {
    visit("/people?open=away", "data_steward");
    mount();
    const form = await screen.findByTestId("away-form");
    const who = within(form).getByRole("combobox", { name: "Who covers" });
    await waitFor(() => expect(within(who).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(who, { target: { value: "u-an" } });
    fireEvent.change(within(form).getByLabelText("First day"), { target: { value: "2026-11-02" } });
    fireEvent.change(within(form).getByLabelText("Last day"), { target: { value: "2026-11-06" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set out of office" }));
    expect(await screen.findByText(/^A\. Naidoo covers your approvals/)).toBeInTheDocument();
    expect(rolesAudit().map((a) => a.action)).toContain("delegation.create");
  });

  it("may balance work (assign) and sees the button on People", async () => {
    visit("/people?open=balance", "data_steward");
    mount();
    expect(await screen.findByRole("button", { name: "Propose a plan" })).toBeEnabled();
  });
});
