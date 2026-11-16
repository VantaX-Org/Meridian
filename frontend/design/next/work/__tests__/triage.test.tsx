import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { resetTriageFixture } from "@/lib/api/v2/fixtures/triage";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { WorkTriage } from "../Triage";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  resetTriageFixture();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

const mount = (search = "") => {
  const url = `/next/work/triage?fixture=1${search}`;
  window.history.pushState({}, "", url);
  setUrl(url);
  return renderWithQuery(<ToastProvider><WorkTriage /></ToastProvider>);
};

describe("native triage", () => {
  it("ranks the queue with the SLA record, teams and rules", async () => {
    mount();
    expect(await screen.findByText(/items waiting, .* past their SLA/)).toBeTruthy();
    const overdue = await screen.findByTestId("triage-overdue");
    expect(within(overdue).getAllByText("MM142").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("triage-teams")).toBeTruthy();
    expect(await screen.findByTestId("triage-rules")).toBeTruthy();
  });

  it("assigns the items past their SLA in bulk", async () => {
    mount();
    await userEvent.click(await screen.findByTestId("triage-primary"));
    const form = await screen.findByTestId("triage-bulk");
    await userEvent.selectOptions(within(form).getByLabelText("Assign to"), "u-an");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/of \d+ items updated\./)).toBeTruthy();
  });

  it("offers a viewer no bulk, team or rule changes", async () => {
    mount("&role=viewer");
    await screen.findByTestId("triage-overdue");
    await screen.findByTestId("triage-rules");
    expect(screen.queryByTestId("triage-primary")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change the selected items" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move .* up$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create a team" })).toBeNull();
  });
});
