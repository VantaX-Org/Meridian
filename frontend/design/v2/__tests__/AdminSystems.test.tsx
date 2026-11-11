import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { visibleSections } from "@/lib/v2/admin-sections";
import { AdminCanvas } from "../admin/Admin";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ can: true }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: true, shared: false, viewAs: null, can: () => h.can }) };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  h.can = true;
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const page = () => {
  setUrl("/admin/systems?fixture=1");
  return renderWithQuery(<AdminCanvas section="systems" />);
};

describe("Admin, SAP systems", () => {
  it("is a section for manage_systems", () => {
    expect(visibleSections((a) => a === "manage_systems").some((s) => s.slug === "systems")).toBe(true);
    expect(visibleSections((a) => a === "view").some((s) => s.slug === "systems")).toBe(false);
  });

  it("lists each system with a link to its connection settings and a way to connect a new one", async () => {
    page();
    const edits = await screen.findAllByRole("link", { name: "Connection settings" });
    expect(edits.length).toBeGreaterThan(0);
    expect(edits[0].getAttribute("href")).toMatch(/^\/s\/[^/?]+\?open=connection:/);
    expect(screen.getAllByRole("link", { name: "Connect a system" })[0].getAttribute("href")).toMatch(/^\/s\/new(\?|$)/);
    expect(screen.getByText(/asks for the password again/)).toBeInTheDocument();
  });

  it("tests a connection from the row and removes a system only after its name is typed", async () => {
    page();
    const test = (await screen.findAllByRole("button", { name: /^Test the connection of / }))[0];
    fireEvent.click(test);
    await waitFor(() => expect(test).not.toBeDisabled());
    const name = (test.getAttribute("aria-label") ?? "").replace("Test the connection of ", "");
    fireEvent.click(screen.getAllByRole("button", { name: `Remove ${name}` })[0]);
    const confirm = await screen.findByRole("button", { name: "Remove system" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type .* to continue/), { target: { value: name } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("admin-dialog")).toBeNull();
  });

  it("asks for the permission when the viewer lacks it", async () => {
    h.can = false;
    page();
    expect(await screen.findByTestId("needs-permission")).toBeInTheDocument();
  });
});
