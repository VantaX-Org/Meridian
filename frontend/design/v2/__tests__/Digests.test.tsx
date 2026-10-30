import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s10 from "@/lib/api/v2/step10";
import { visibleSections } from "@/lib/v2/admin-sections";
import { emailsFrom, zoneOk } from "@/lib/v2/step10";
import { Inspector } from "../Inspector";
import { AdminCanvas } from "../admin/Admin";
import { resetKeptOutcomes } from "../inspector/shared";
import { getUrl, setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetKeptOutcomes();
  undo = stubLayout(1400, 600);
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const page = (open = "") => {
  setUrl(`/admin/digests?fixture=1${open ? `&open=${open}` : ""}`);
  return renderWithQuery(
    <>
      <AdminCanvas section="digests" />
      <Inspector />
    </>,
  );
};

describe("Admin, Digests", () => {
  it("is a Notifications section for manage_settings only", () => {
    expect(visibleSections((a) => a === "manage_settings").find((s) => s.slug === "digests")?.group).toBe("Notifications");
    expect(visibleSections((a) => a === "view").some((s) => s.slug === "digests")).toBe(false);
  });

  it("lists the digests with who they are for, the cadence in words, the channel and the last send", async () => {
    page();
    const grid = await screen.findByRole("grid", { name: "Digests" });
    await waitFor(() => expect(norm(grid)).toContain("Monday leadership digest"));
    expect(norm(grid)).toContain("Role: Programme lead / CIO");
    expect(norm(grid)).toContain("Mondays at 07:00 UTC, Africa/Johannesburg");
    expect(norm(grid)).toContain("Wave: Wave 2: master data");
    expect(norm(grid)).toContain("Alert channel");
    expect(norm(grid)).toContain("Paused");
  });

  it("says which permission it needs to anyone without manage_settings", async () => {
    h.allowed = ["view"];
    page();
    expect(await screen.findByTestId("needs-permission")).toHaveTextContent("Managing digests needs the manage settings permission");
  });

  it("adds a wave digest by email: the cron is checked as it is typed, the recipients are needed, then it saves", async () => {
    const spy = vi.spyOn(s10, "createDigest");
    page("digest:new");
    const form = await screen.findByTestId("digest-form");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Wave 1 Friday" } });
    fireEvent.click(within(form).getByRole("button", { name: "A migration wave" }));
    await waitFor(() => expect(within(form).getByRole("option", { name: "Wave 1: finance foundations" })).toBeInTheDocument());
    fireEvent.change(within(form).getByLabelText("Wave"), { target: { value: "w-1" } });
    fireEvent.change(within(form).getByLabelText("Cron expression"), { target: { value: "0 7 * *" } });
    expect(within(form).getByText("Enter five fields: minute, hour, day, month, weekday")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Cron expression"), { target: { value: "30 6 * * 5" } });
    fireEvent.change(within(form).getByLabelText("Time zone"), { target: { value: "Europe/Berlin" } });
    expect(within(form).getByText("A wave digest by email needs at least one recipient.")).toBeInTheDocument();
    const save = within(form).getByRole("button", { name: "Add the digest" });
    expect(save).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Email addresses"), { target: { value: "cfo@demo-corp.example, not-an-address" } });
    expect(within(form).getByText("Not an email address: not-an-address")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Email addresses"), { target: { value: "cfo@demo-corp.example\nfinance-lead@demo-corp.example" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ name: "Wave 1 Friday", audience: "wave", wave_id: "w-1", role: null, cron: "30 6 * * 5", timezone: "Europe/Berlin", channel: "email", recipients: ["cfo@demo-corp.example", "finance-lead@demo-corp.example"], attach_pdf: true, enabled: true });
    await waitFor(() => expect(getUrl()).toContain("open=digest%3Adg-101"));
  });

  it("sends a digest now, previews it in a sandboxed frame and as numbers, and shows its delivery log", async () => {
    page("digest:dg-1");
    const insp = await screen.findByTestId("inspector");
    await waitFor(() => expect(norm(insp)).toContain("Monday leadership digest"));
    expect(norm(insp)).toContain("steering@demo-corp.example");
    const log = await within(insp).findByTestId("digest-deliveries");
    expect(norm(log)).toContain("1 recipient refused: mailbox full");
    fireEvent.click(within(insp).getByRole("button", { name: "Send now" }));
    expect(await within(insp).findByText("Digest sent")).toBeInTheDocument();
    expect(within(insp).getByText("2 delivered, 0 failed.")).toBeInTheDocument();
    await waitFor(() => expect(norm(within(insp).getByTestId("digest-deliveries"))).toContain("sent by hand"));
    fireEvent.click(within(insp).getByRole("button", { name: "Preview" }));
    const dlg = await screen.findByRole("dialog", { name: "Preview of Monday leadership digest" });
    const frame = await within(dlg).findByTestId("digest-iframe");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("Score moves");
    fireEvent.click(within(dlg).getByRole("button", { name: "The numbers" }));
    const nums = await within(dlg).findByTestId("digest-numbers");
    expect(norm(nums)).toContain("objects held under 85");
    expect(norm(nums)).toContain("Approvals waiting4");
    expect(norm(nums)).toContain("ZAR 4,120,000");
  });

  it("pauses, edits and deletes a digest", async () => {
    const upd = vi.spyOn(s10, "updateDigest");
    const del = vi.spyOn(s10, "deleteDigest");
    page("digest:dg-1");
    const insp = await screen.findByTestId("inspector");
    fireEvent.click(await within(insp).findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(upd).toHaveBeenCalledWith("dg-1", { enabled: false }));
    fireEvent.click(await within(insp).findByRole("button", { name: "Edit" }));
    const form = await within(insp).findByTestId("digest-form");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Monday digest for the CIO" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(upd).toHaveBeenLastCalledWith("dg-1", { name: "Monday digest for the CIO" }));
    fireEvent.click(within(insp).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog", { name: /^Delete Monday digest for the CIO/ });
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the digest" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("dg-1"));
  });

  it("reads emails and time zones the way the API checks them", () => {
    expect(emailsFrom(" a@x.example, b@x.example\na@x.example ")).toEqual(["a@x.example", "b@x.example"]);
    expect(zoneOk("Africa/Johannesburg")).toBe(true);
    expect(zoneOk("Mars/Olympus")).toBe(false);
  });
});

describe("Administration's index names each place once", () => {
  it("no item carries its group's name, and nothing repeats the Runs page", async () => {
    const { ADMIN_SECTIONS } = await import("@/lib/v2/admin-sections");
    for (const s of ADMIN_SECTIONS) expect(s.label, s.slug).not.toBe(s.group);
    expect(ADMIN_SECTIONS.map((s) => s.label)).not.toContain("Runs and jobs");
    expect(new Set(ADMIN_SECTIONS.map((s) => s.label)).size).toBe(ADMIN_SECTIONS.length);
  });
});
