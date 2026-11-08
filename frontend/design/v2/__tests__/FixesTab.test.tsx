import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { FixesTab } from "../screens/object/FixesTab";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/o/ecc-production/material-master/fixes?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

describe("the Fixes tab", () => {
  it("lists the batches that hold records of this object, not an empty frame", async () => {
    renderWithQuery(<FixesTab system="ecc-production" module="material-master" />);
    const grid = await screen.findByRole("grid", { name: /^Fix batches of / });
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(1));
    expect(screen.queryByTestId("empty-frame")).toBeNull();
  });

  it("keeps the empty frame for an object with no batches", async () => {
    renderWithQuery(<FixesTab system="ecc-production" module="customer-master" />);
    expect(await screen.findByTestId("empty-frame")).toHaveTextContent(/No fix batches for .* yet/);
  });
});
