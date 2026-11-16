import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { resetExceptionsFixture } from "@/lib/api/v2/fixtures/exceptions";
import { ToastProvider } from "../../kit";
import { WorkExceptions } from "../Exceptions";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
const Q = vi.hoisted(() => ({ can: (a: string): boolean => a !== "", shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({
  ...(await orig<object>()),
  useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }),
}));

let undo: () => void = () => undefined;
beforeEach(() => {
  Q.can = (a) => a !== "";
  Q.shared = false;
  resetExceptionsFixture();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.history.pushState({}, "", "/next/work/exceptions?fixture=1");
  setUrl("/next/work/exceptions?fixture=1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.history.pushState({}, "", "/");
  window.sessionStorage.clear();
});

const page = () => renderWithQuery(<ToastProvider><WorkExceptions /></ToastProvider>);

describe("Work exceptions", () => {
  it("renders the banner, the list and the rules from the fixture", async () => {
    page();
    const banner = await screen.findByTestId("exceptions-banner");
    expect(within(banner).getByRole("heading", { name: /exceptions still open/ })).toBeTruthy();
    expect(screen.getByTestId("exceptions-severity")).toBeTruthy();
    expect(within(screen.getByTestId("exceptions-table")).getAllByText("Goods receipt posted to a blocked material").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("exceptions-rules")).toBeTruthy();
    expect(screen.getByTestId("new-rule-open")).toBeTruthy();
    expect(screen.getByTestId("raise-exception-open")).toBeTruthy();
  });

  it("opens the nearest deadline and resolves it", async () => {
    page();
    fireEvent.click(await screen.findByTestId("exceptions-primary"));
    const detail = await screen.findByTestId("exceptions-detail");
    const form = within(detail).getByRole("form", { name: "Resolve the exception" });
    fireEvent.change(within(form).getByLabelText("Resolution"), { target: { value: "steward" } });
    fireEvent.click(within(form).getByRole("button", { name: "Resolve" }));
    expect(await screen.findByText("Exception resolved.")).toBeTruthy();
  });

  it("hides rule management and the resolve form without the permissions", async () => {
    Q.can = (a) => a !== "manage_rules" && a !== "approve";
    page();
    const rules = await screen.findByTestId("exceptions-rules");
    expect(screen.queryByTestId("new-rule-open")).toBeNull();
    expect(within(rules).queryAllByRole("button", { pressed: true })).toHaveLength(0);
    expect(within(rules).getAllByText("Off").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("exceptions-primary"));
    const detail = await screen.findByTestId("exceptions-detail");
    expect(within(detail).queryByRole("form", { name: "Resolve the exception" })).toBeNull();
    expect(within(detail).getByRole("form", { name: "Assign the exception" })).toBeTruthy();
  });

  it("offers no writes on a shared link", async () => {
    Q.shared = true;
    page();
    await screen.findByTestId("exceptions-rules");
    expect(screen.queryByTestId("raise-exception-open")).toBeNull();
    expect(screen.queryByTestId("new-rule-open")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("exceptions-primary")).toBeTruthy());
  });
});
