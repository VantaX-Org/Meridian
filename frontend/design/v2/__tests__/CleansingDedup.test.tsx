import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetCleaningFixture } from "@/lib/api/v2/fixtures/cleaning";
import { Cleansing } from "../screens/Cleansing";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  resetCleaningFixture();
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/cleansing");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("cleansing duplicates", () => {
  it("compares a pair and merges it only with a reason", async () => {
    renderWithQuery(<Cleansing />);
    fireEvent.click(await screen.findByTestId("cleansing-dedup-open-dd-1"));
    const merge = await screen.findByTestId("cleansing-dedup-merge-dd-1");
    expect(within(merge).getAllByText("+1 414 671 4400")).toHaveLength(2);
    const btn = screen.getByTestId("cleansing-dedup-merge-btn-dd-1");
    expect(btn).toBeDisabled();
    fireEvent.click(screen.getByTestId("cleansing-dedup-keep-0000100877"));
    fireEvent.change(screen.getByTestId("cleansing-dedup-reason-dd-1"), { target: { value: "Same tax number" } });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByTestId("cleansing-dedup-dd-1")).toBeNull());
    expect(screen.getByTestId("cleansing-dedup-dd-2")).toBeInTheDocument();
  });

  it("filters the pairs by object type through the per-type route", async () => {
    renderWithQuery(<Cleansing />);
    const sel = await screen.findByTestId("cleansing-dedup-type");
    await screen.findByTestId("cleansing-dedup-dd-2");
    fireEvent.change(sel, { target: { value: "business_partner" } });
    await waitFor(() => expect(screen.queryByTestId("cleansing-dedup-dd-2")).toBeNull());
    expect(await screen.findByTestId("cleansing-dedup-dd-1")).toBeInTheDocument();
    expect(screen.queryByTestId("cleansing-dedup-dd-2")).toBeNull();
  });
});
