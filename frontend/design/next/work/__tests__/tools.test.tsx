import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { WorkTools } from "../Tools";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  setUrl("/work?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
});

const columns = [
  { id: "record", header: "Record", cell: (r: { key: string }) => r.key },
  { id: "who", header: "Who", cell: () => "Nobody yet" },
];

describe("Work grid tools (next)", () => {
  it("lists saved views and saves the chosen columns as a new view", async () => {
    const onColumns = vi.fn();
    renderWithQuery(
      <ToastProvider>
        <WorkTools gridId="test-grid" route="work" title="Work" columns={columns} rows={[{ key: "MAT-1" }]} filters={{ status: "open" }} onColumns={onColumns} />
      </ToastProvider>,
    );
    const select = screen.getByLabelText("Views");
    await waitFor(() => expect(within(select).getByText("My open work (Built in)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save these columns as a view…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Only records" } });
    fireEvent.click(within(dialog).getByLabelText("Who"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
    await waitFor(() => expect(onColumns).toHaveBeenCalled());
    expect(JSON.parse(window.localStorage.getItem("m2:cols:test-grid") ?? "[]")).toEqual(["who"]);
  });
});
