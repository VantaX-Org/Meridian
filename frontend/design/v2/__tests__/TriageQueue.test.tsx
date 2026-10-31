import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Triage } from "../screens/Triage";
import { resetTriageFixture } from "@/lib/api/v2/fixtures/triage";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, id: "u-me", fixture: true, shared: false, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  h.allowed = "all";
  resetTriageFixture();
  setUrl("/work/triage?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Triage", () => {
  it("states the waiting and breached items and buckets my work by due date", async () => {
    renderWithQuery(<Triage />);
    expect((await screen.findByTestId("triage-banner")).textContent).toMatch(/items waiting, \d+ past their SLA/);
    const overdue = await screen.findByTestId("triage-overdue");
    expect(within(overdue).getAllByTestId("triage-row")).toHaveLength(2);
    expect(overdue.textContent).toContain("MM142");
  });

  it("sets the priority of the selected items in one bulk action", async () => {
    renderWithQuery(<Triage />);
    const overdue = await screen.findByTestId("triage-overdue");
    for (const box of within(overdue).getAllByRole("checkbox")) fireEvent.click(box);
    const form = await screen.findByRole("form", { name: "Change the selected items" });
    const [action] = within(form).getAllByRole("combobox");
    fireEvent.change(action, { target: { value: "priority" } });
    fireEvent.change(within(form).getAllByRole("combobox")[1], { target: { value: "5" } });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByTestId("triage-overdue").textContent?.match(/P5/g)).toHaveLength(2));
  });

  it("hides selection and the team and rule editors from a role that can only view", async () => {
    h.allowed = ["view"];
    renderWithQuery(<Triage />);
    await screen.findByTestId("triage-overdue");
    expect(screen.queryAllByRole("checkbox", { name: /^Select / })).toHaveLength(0);
    expect(screen.queryByRole("form", { name: "Create a team" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Create an assignment rule" })).toBeNull();
  });

  it("moves an assignment rule up the evaluation order", async () => {
    renderWithQuery(<Triage />);
    const rules = await screen.findByTestId("triage-rules");
    const second = await within(rules).findByRole("button", { name: "Move Finance modules up" });
    fireEvent.click(second);
    await waitFor(() => expect(within(screen.getByTestId("triage-rules")).getAllByRole("rowheader")[0].textContent).toContain("Finance modules"));
  });
});
