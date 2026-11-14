import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { SheetHost } from "@/design/next/shell/SheetHost";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import type { TabId } from "../../object/tabs";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import { ownersOf } from "../SteeringReport";
import type { Issue } from "@/lib/api/v2/issues";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => { window.sessionStorage.clear(); vi.clearAllMocks(); });

function open(tab: TabId, query = "") {
  setUrl(`/next/o/ecc-production/material-master/${tab}?fixture=1${query}`);
  return renderWithQuery(<ToastProvider><SheetHost><ObjectPage system="ecc-production" module="material-master" tab={tab} /></SheetHost></ToastProvider>);
}

describe("failing records", () => {
  it("lists failing rules, then fills the records of the chosen rule and pages them", async () => {
    open("failing");
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Failing rules" })).getAllByRole("row").length).toBeGreaterThan(1));
    expect(screen.getByText("No rule chosen yet.")).toBeTruthy();
    await waitFor(() => {
      fireEvent.click(within(screen.getByRole("table", { name: "Failing rules" })).getAllByRole("row")[1]);
      expect(getUrl()).toMatch(/rule=/);
    });
    const recs = await screen.findByRole("table", { name: /^Records failing / });
    await waitFor(() => expect(within(recs).getAllByRole("row").length).toBeGreaterThan(1));
    expect(within(recs).getAllByText(/MAT-0000/).length).toBeGreaterThan(0);
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText(/26 to 50 of/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
  });
});

describe("steering report", () => {
  it("shows score, top rules with text, owners, next actions and a print button", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    open("report");
    const rep = await screen.findByTestId("steering-report");
    await waitFor(() => {
      expect(within(rep).getByText("Next actions")).toBeTruthy();
      expect(within(rep).getByText("Owners of open records")).toBeTruthy();
      expect(within(rep).getByText("Top failing rules")).toBeTruthy();
    });
    fireEvent.click(within(rep).getByRole("button", { name: "Print report" }));
    expect(print).toHaveBeenCalled();
    expect(screen.getByTestId("load-files")).toBeTruthy();
  });

  it("groups open issues by holder, unassigned last-resort label", () => {
    const mk = (status: Issue["status"], email: string | null): Issue => ({ status, assignee_email: email, assigned_to: null } as Issue);
    const out = ownersOf([mk("open", "a@x.test"), mk("open", "a@x.test"), mk("open", null), mk("resolved", "a@x.test")]);
    expect(out).toEqual([{ owner: "a@x.test", open: 2 }, { owner: "Unassigned", open: 1 }]);
  });
});
