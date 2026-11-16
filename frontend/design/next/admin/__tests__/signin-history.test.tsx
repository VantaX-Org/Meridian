import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../../kit";
import { SheetHost } from "../../shell/SheetHost";
import { AdminCanvas } from "../sections/Canvas";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
const go = (u: string) => { window.history.pushState({}, "", u); setUrl(u); };
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});
const view = () => renderWithQuery(<ToastProvider><SheetHost><AdminCanvas section="signin" /></SheetHost></ToastProvider>);

describe("sign-in history", () => {
  it("lists every attempt with its outcome, and the Failed filter drops the successes", async () => {
    go("/more/admin/signin?fixture=1");
    view();
    const grid = await screen.findByRole("table", { name: "Sign-in history" });
    await waitFor(() => expect(within(grid).getAllByText("Signed in").length).toBeGreaterThan(0));
    expect(within(grid).getAllByText("Wrong password").length).toBeGreaterThan(0);
    expect(within(grid).getByText("No such account")).toBeInTheDocument();
    expect(within(grid).getByText("203.0.113.44")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("signin-outcome"), { target: { value: "failed" } });
    await waitFor(() => expect(within(screen.getByRole("table", { name: "Sign-in history" })).getByText("Refused by single sign-on")).toBeInTheDocument());
    expect(within(screen.getByRole("table", { name: "Sign-in history" })).queryByText("Signed in")).toBeNull();
  });
});
