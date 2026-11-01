import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/issues";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { Issues } from "../screens/Issues";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
  setUrl("/issues");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Record issues", () => {
  it("shows the open issues most severe first with rule, field and owner", async () => {
    renderWithQuery(<Issues />);
    const banner = await screen.findByTestId("issues-banner");
    expect(banner.textContent).toMatch(/issues still to close/);
    const table = screen.getByTestId("issues-table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("MM142");
    expect(rows[0]).toHaveTextContent("MBEW-BKLAS");
    expect(within(table).getAllByText("Valuation class is blank for a valuated material type").length).toBeGreaterThan(0);
  });

  it("filters by status and by assignee", async () => {
    renderWithQuery(<Issues />);
    const tabs = await screen.findByTestId("issues-tabs");
    const spy = vi.spyOn(api, "getIssues");
    fireEvent.click(within(tabs).getByRole("button", { name: /Waiting on SAP/ }));
    await waitFor(() => expect(within(screen.getByTestId("issues-table")).getAllByRole("row")).toHaveLength(2));
    const form = screen.getByTestId("issues-filter");
    fireEvent.change(within(form).getAllByRole("combobox")[1], { target: { value: "unassigned" } });
    fireEvent.submit(form);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ status: "waiting_sap", assigned_to: "unassigned" })));
    expect(await screen.findByText("No issues match. Change the status or the filter.")).toBeInTheDocument();
  });

  it("moves selected issues in bulk and asks for a resolution when accepting", async () => {
    renderWithQuery(<ToastProvider><Issues /></ToastProvider>);
    const table = await screen.findByTestId("issues-table");
    fireEvent.click(within(table).getAllByRole("checkbox")[1]);
    const bar = await screen.findByTestId("issues-bulk");
    const apply = within(bar).getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    fireEvent.change(within(bar).getAllByRole("combobox")[0], { target: { value: "accepted" } });
    expect(apply).toBeDisabled();
    fireEvent.change(within(bar).getAllByRole("combobox")[1], { target: { value: "accepted_risk" } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(await screen.findByText("1 issues updated.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("issues-bulk")).toBeNull());
  });

  it("opens one issue with its runs and history and takes a comment", async () => {
    renderWithQuery(<Issues />);
    const table = await screen.findByTestId("issues-table");
    fireEvent.click(within(table).getAllByRole("button")[0]);
    const detail = await screen.findByTestId("issues-detail");
    expect(await within(detail).findByTestId("issues-runs")).toHaveTextContent("Failing");
    fireEvent.change(within(detail).getByRole("textbox"), { target: { value: "Checked with finance." } });
    fireEvent.click(within(detail).getByRole("button", { name: "Add comment" }));
    expect(await within(detail).findByText("Checked with finance.")).toBeInTheDocument();
  });
});
