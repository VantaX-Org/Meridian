import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as adminApi from "@/lib/api/v2/admin";
import { resetAdminFixture } from "@/lib/api/v2/fixtures";
import { ReferenceSection } from "../admin/data";
import { resetKeptOutcomes } from "../inspector/shared";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});

const SYS = "a1b2c3d4-0001-4000-8000-000000000001";
let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetAdminFixture();
  resetKeptOutcomes();
  undo = stubLayout();
  h.allowed = "all";
  setUrl("/admin/reference?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Admin: removing a reference list", () => {
  it("asks first, then deletes the list and says how many records went", async () => {
    const spy = vi.spyOn(adminApi, "deleteReference");
    renderWithQuery(<ReferenceSection />);
    await screen.findByRole("table", { name: "Reference lists" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Postal codes" }));
    const dlg = await screen.findByRole("dialog", { name: "Remove Postal codes" });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove the list" }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(SYS, "postal-codes"));
    expect(await screen.findByText(/No reference data is loaded for/)).toBeInTheDocument();
  });

  it("cancelling deletes nothing", async () => {
    const spy = vi.spyOn(adminApi, "deleteReference");
    renderWithQuery(<ReferenceSection />);
    await screen.findByRole("table", { name: "Reference lists" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Postal codes" }));
    const dlg = await screen.findByRole("dialog", { name: "Remove Postal codes" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("table", { name: "Reference lists" })).toHaveTextContent("48,210");
  });

  it("a list that is already gone answers not found and the dialog closes without a crash", async () => {
    renderWithQuery(<ReferenceSection />);
    await screen.findByRole("table", { name: "Reference lists" });
    await adminApi.deleteReference(SYS, "postal-codes");
    fireEvent.click(screen.getByRole("button", { name: "Remove Postal codes" }));
    const dlg = await screen.findByRole("dialog", { name: "Remove Postal codes" });
    fireEvent.click(within(dlg).getByRole("button", { name: "Remove the list" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("without the manage systems permission there is no Remove button", async () => {
    h.allowed = ["view"];
    renderWithQuery(<ReferenceSection />);
    await screen.findByTestId("needs-permission");
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});
