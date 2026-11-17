import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { Home } from "./Home";
import { Objects } from "./Objects";
import { Status } from "./Status";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const wrap = (el: React.ReactNode) => renderWithQuery(<AletheiaProvider><ToastHost>{el}</ToastHost></AletheiaProvider>);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/?fixture=1");
});
afterEach(() => undo());

describe("Home", () => {
  it("shows the header, the lowest scoring objects and the attention list", async () => {
    wrap(<Home />);
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Next action per object" })).toBeTruthy();
    expect(await screen.findByRole("list", { name: "Attention items" })).toBeTruthy();
  });

  it("asks before pulling every object", async () => {
    wrap(<Home />);
    const btn = await screen.findByRole("button", { name: "Pull every object" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });
});

describe("Objects", () => {
  it("lists objects and filters by search", async () => {
    window.history.replaceState(null, "", "/o?fixture=1");
    wrap(<Objects />);
    expect(await screen.findByRole("heading", { level: 1, name: "Objects" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search objects" }), { target: { value: "zzzz-no-such" } });
    expect(await screen.findByText("No object matches")).toBeTruthy();
  });
});

describe("Status", () => {
  it("shows overall state and the components table", async () => {
    window.history.replaceState(null, "", "/status?fixture=1");
    wrap(<Status />);
    expect(await screen.findByRole("heading", { level: 1, name: "Status" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1));
  });
});
