import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { WorkQueue } from "../Queue";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
const decide = vi.fn(async () => true);
vi.mock("@/lib/v2/work-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/v2/work-actions")>()),
  useWorkActions: () => ({ decide, acceptRule: vi.fn(async () => true), undoLast: () => undefined, clear: () => undefined }),
}));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  decide.mockClear();
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

  it("decides a row in place: a reason for not an issue, a typed value for fix", async () => {
    setUrl("/work?fixture=1");
    renderWithQuery(<ToastProvider><WorkQueue /></ToastProvider>);
    const selects = await screen.findAllByRole("combobox", { name: /^Decision for / });
    const select = selects[0] as HTMLSelectElement;
    const key = (select.getAttribute("aria-label") ?? "").replace("Decision for ", "");
    expect(within(select).getByRole("option", { name: "not an issue" })).toBeTruthy();

    fireEvent.change(select, { target: { value: "not an issue" } });
    const dialog = await screen.findByRole("dialog", { name: "Mark as not an issue" });
    expect(within(dialog).getByLabelText("Reason")).toBeTruthy();
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.change(screen.getAllByLabelText(`New value for ${key}`)[0], { target: { value: "KG" } });
    fireEvent.change(screen.getAllByRole("combobox", { name: `Decision for ${key}` })[0], { target: { value: "fix" } });
    await waitFor(() => expect(decide).toHaveBeenCalledWith([expect.objectContaining({ record_key: expect.any(String) })], "edit", { value: "KG" }));
  });
});
