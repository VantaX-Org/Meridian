import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetSubjectFixture } from "@/lib/api/v2/fixtures/subject-requests";
import { visibleSections } from "@/lib/v2/admin-sections";
import { AdminCanvas } from "../admin/Admin";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ can: true }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => h.can }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetSubjectFixture();
  h.can = true;
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const page = () => {
  setUrl("/admin/subjectrequests?fixture=1");
  return renderWithQuery(<AdminCanvas section="subjectrequests" />);
};
const search = async (subject: string) => {
  fireEvent.change(await screen.findByLabelText("Record key or value"), { target: { value: subject } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
};

describe("Admin, Data subject requests", () => {
  it("is a section for manage_settings", () => {
    expect(visibleSections((a) => a === "manage_settings").some((s) => s.slug === "subjectrequests")).toBe(true);
    expect(visibleSections((a) => a === "view").some((s) => s.slug === "subjectrequests")).toBe(false);
  });

  it("states what erasure cannot do before anything is typed", async () => {
    page();
    expect(await screen.findByText("Meridian does not delete from SAP. Erase the record there as well.")).toBeInTheDocument();
    expect(screen.getByText(/Backups of the database and the object store are out of reach/)).toBeInTheDocument();
    expect(screen.getByText(/The suppression list drops an erased key/)).toBeInTheDocument();
  });

  it("asks for the permission when the viewer lacks it", async () => {
    h.can = false;
    page();
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
  });

  it("finds a synthetic subject, with each table code beside its description", async () => {
    page();
    await search("SYNTH-0001");
    expect((await screen.findAllByText(/13 rows across 7 tables and 2 extract files/)).length).toBeGreaterThan(0);
    expect(screen.getByText("finding_records")).toBeInTheDocument();
    expect(screen.getByText("Records that failed a rule, per run")).toBeInTheDocument();
  });

  it("describes the comment, notification and exception stores, and says which rows are kept", async () => {
    page();
    await search("SYNTH-0001");
    expect(await screen.findByText("Notifications that name this record")).toBeInTheDocument();
    expect(screen.getByText("Exceptions that list this record as affected")).toBeInTheDocument();
    expect(screen.getAllByText("Row kept, key and values cleared")).toHaveLength(2);
  });

  it("says so when nothing is held", async () => {
    page();
    await search("NOBODY-9999");
    expect((await screen.findAllByText("Nothing is held for this key.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Dry run an erasure" })).toBeDisabled();
  });

  it("keeps Erase disabled until a dry run, the word and a reason are all given, then erases", async () => {
    page();
    await search("SYNTH-0001");
    await screen.findAllByText(/13 rows across/);
    expect(screen.queryByRole("button", { name: "Erase permanently" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dry run an erasure" }));
    const erase = await screen.findByRole("button", { name: "Erase permanently" });
    expect(screen.getByText(/Nothing has been deleted/)).toBeInTheDocument();
    expect(erase).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type ERASE to confirm"), { target: { value: "ERASE" } });
    expect(erase).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason, at least 10 characters"), { target: { value: "Subject request 0001" } });
    expect(erase).toBeEnabled();
    fireEvent.click(erase);
    expect(await screen.findByText("13 rows removed or cleared.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Erase permanently" })).toBeNull());
  });

  it("shows the server refusal as a sentence", async () => {
    const api = await import("@/lib/api/v2/subject-requests");
    page();
    await search("SYNTH-0001");
    await screen.findAllByText(/13 rows across/);
    fireEvent.click(screen.getByRole("button", { name: "Dry run an erasure" }));
    const erase = await screen.findByRole("button", { name: "Erase permanently" });
    vi.spyOn(api, "executeErasure").mockRejectedValue({ response: { status: 409, data: { detail: { error: "dry_run_stale", message: "The records changed since the dry run." } } } });
    fireEvent.change(screen.getByLabelText("Type ERASE to confirm"), { target: { value: "ERASE" } });
    fireEvent.change(screen.getByLabelText("Reason, at least 10 characters"), { target: { value: "Subject request 0001" } });
    fireEvent.click(erase);
    expect(await screen.findByText("The records changed since the dry run.")).toBeInTheDocument();
  });

  it("lists the suppression after an erasure, with the field description, and lifts it with a reason", async () => {
    page();
    expect(await screen.findByText("No suppressions yet.")).toBeInTheDocument();
    await search("SYNTH-0001");
    await screen.findAllByText(/13 rows across/);
    fireEvent.click(screen.getByRole("button", { name: "Dry run an erasure" }));
    fireEvent.change(await screen.findByLabelText("Type ERASE to confirm"), { target: { value: "ERASE" } });
    fireEvent.change(screen.getByLabelText("Reason, at least 10 characters"), { target: { value: "Subject request 0001" } });
    fireEvent.click(screen.getByRole("button", { name: "Erase permanently" }));
    await screen.findByText("13 rows removed or cleared.");
    expect(await screen.findByText("1 active keys, 0 rows dropped.")).toBeInTheDocument();
    expect(screen.getByText(/Material number/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lift" }));
    const go = screen.getAllByRole("button", { name: "Lift" }).at(-1)!;
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason, at least 10 characters"), { target: { value: "Record is valid again" } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    expect(await screen.findByText("0 active keys, 0 rows dropped.")).toBeInTheDocument();
  });
});
