import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as s9 from "@/lib/api/v2/step9";
import { visibleSections } from "@/lib/v2/admin-sections";
import { Inspector } from "../Inspector";
import { AdminCanvas } from "../admin/Admin";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
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
  undo = stubLayout();
  h.allowed = "all";
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const page = (open = "") => {
  setUrl(`/v2/admin/webhooks?fixture=1${open ? `&open=${open}` : ""}`);
  return renderWithQuery(
    <>
      <AdminCanvas section="webhooks" />
      <Inspector />
    </>,
  );
};

describe("Admin, Webhooks", () => {
  it("is a section for manage_settings only", () => {
    expect(visibleSections((a) => a === "manage_settings").some((s) => s.slug === "webhooks")).toBe(true);
    expect(visibleSections((a) => a === "view").some((s) => s.slug === "webhooks")).toBe(false);
  });

  it("lists the webhooks with their host, events and state, and the automation settings", async () => {
    page();
    const grid = await screen.findByRole("grid", { name: "Webhooks" });
    await waitFor(() => expect(norm(grid)).toContain("hooks.slack.com"));
    expect(norm(grid)).toContain("A critical rule went over tolerance");
    expect(norm(grid)).toContain("Paused");
    expect(await screen.findByLabelText(/Config drift alerts/)).toBeChecked();
    expect(screen.getByLabelText(/^Repeated fixes that make a learned rule/)).toHaveValue(25);
  });

  it("adds a webhook from the Teams preset and shows the secret once", async () => {
    const spy = vi.spyOn(s9, "createWebhook");
    page("webhook:new");
    const insp = await screen.findByTestId("inspector");
    fireEvent.click(within(insp).getByRole("button", { name: "Teams workflow" }));
    expect(within(insp).getByRole("checkbox", { name: /A fix batch waits for approval/ })).toBeChecked();
    fireEvent.change(within(insp).getByLabelText("URL"), { target: { value: "http://plain" } });
    expect(within(insp).getByRole("alert")).toHaveTextContent("The URL must start with https://.");
    fireEvent.change(within(insp).getByLabelText("URL"), { target: { value: "https://prod-00.example.com/workflows/abc" } });
    fireEvent.click(within(insp).getByRole("button", { name: "Add the webhook" }));
    expect(await screen.findByTestId("webhook-secret")).toHaveTextContent(/^whsec_fixture_/);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ url: "https://prod-00.example.com/workflows/abc", events: ["batch.waiting", "breach.new", "certificate.signed", "config.drift"], description: "Teams workflow" }));
  });

  it("sends a test event, pauses, and keeps a delivery log with attempts and answers", async () => {
    page("webhook:wh-1");
    const insp = await screen.findByTestId("inspector");
    const log = await within(insp).findByTestId("delivery-log");
    const cells = within(log).getAllByRole("row").map((r) => Array.from(r.querySelectorAll("th,td")).map((c) => norm(c as HTMLElement)).join(" | "));
    expect(cells[1]).toContain("Retrying | 2 of 5 | 502");
    expect(cells[3]).toContain("Failed | 5 of 5 | 404");
    fireEvent.click(within(insp).getByRole("button", { name: "Send a test event" }));
    expect(await within(insp).findByText("Test event delivered")).toBeInTheDocument();
    await waitFor(() => expect(within(within(insp).getByTestId("delivery-log")).getAllByRole("row")).toHaveLength(6));
    fireEvent.click(within(insp).getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(within(within(insp).getByTestId("delivery-log")).getAllByRole("row")).toHaveLength(2));
    fireEvent.click(within(insp).getByRole("button", { name: "Pause" }));
    expect(await within(await screen.findByTestId("inspector")).findByRole("button", { name: "Enable" })).toBeInTheDocument();
  });

  it("deletes a webhook after a confirmation", async () => {
    const spy = vi.spyOn(s9, "deleteWebhook");
    page("webhook:wh-2");
    const insp = await screen.findByTestId("inspector");
    fireEvent.click(await within(insp).findByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete the webhook" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("wh-2"));
  });

  it("opens one delivery with its retry facts", async () => {
    page("delivery:wh-1:dlv-104");
    const insp = await screen.findByTestId("inspector");
    expect(await within(insp).findByText("2 of 5")).toBeInTheDocument();
    expect(norm(insp)).toContain("score.dropped");
    expect(norm(insp)).toContain("HTTP 502");
    expect(norm(insp)).toContain("retried 1, 2, 4 and 8 minutes");
  });

  it("tells a role without manage_settings what it needs", async () => {
    h.allowed = ["view"];
    page();
    expect(await screen.findByText(/manage_settings|manage settings/i)).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "Webhooks" })).toBeNull();
  });
});
