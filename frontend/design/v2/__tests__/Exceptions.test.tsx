import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Exceptions } from "../screens/Exceptions";
import { resetExceptionsFixture } from "@/lib/api/v2/fixtures/exceptions";
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
  resetExceptionsFixture();
  setUrl("/work/exceptions?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Exceptions", () => {
  it("counts the open exceptions in the banner and lists them nearest SLA first", async () => {
    renderWithQuery(<Exceptions />);
    const banner = await screen.findByTestId("exceptions-banner");
    expect(banner.textContent).toContain("5 exceptions still open");
    const table = await screen.findByTestId("exceptions-table");
    expect(table.textContent).toContain("Goods receipt posted to a blocked material");
    expect(table.textContent).toContain("MIGO 5000412233");
  });

  it("escalates an open exception one tier and notes why", async () => {
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Goods receipt posted to a blocked material" }));
    const form = await screen.findByRole("form", { name: "Escalate the exception" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Stock already consumed" } });
    fireEvent.click(within(form).getByRole("button", { name: "Escalate to tier 2" }));
    await waitFor(() => expect(screen.getByTestId("exceptions-comments").textContent).toContain("Escalated to tier 2: Stock already consumed"));
  });

  it("hides escalate and resolve from a role without approve", async () => {
    h.allowed = ["assign"];
    renderWithQuery(<Exceptions />);
    fireEvent.click(await screen.findByRole("button", { name: "Goods receipt posted to a blocked material" }));
    await screen.findByRole("form", { name: "Assign the exception" });
    expect(screen.queryByRole("form", { name: "Escalate the exception" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Resolve the exception" })).toBeNull();
  });
});
