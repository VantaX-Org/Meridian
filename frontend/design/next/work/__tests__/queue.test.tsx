import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { WorkQueue } from "../Queue";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Filtered work queue (next)", () => {
  it("renders the records of the address state with the pills, filter tags and exports", async () => {
    setUrl("/work?fixture=1&filter=approvals&rule=MM-001");
    renderWithQuery(<ToastProvider><WorkQueue /></ToastProvider>);
    const page = await screen.findByTestId("work-queue");
    expect(within(page).getByRole("group", { name: "Filters in force" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove filter: Rule MM-001" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export fix sheet" })).toBeTruthy();
    expect(screen.getByLabelText("Sort by")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("table", { name: /Records that need work/ })).toBeTruthy());
  });
});
