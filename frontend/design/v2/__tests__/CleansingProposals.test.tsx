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

describe("cleansing proposals", () => {
  it("approves the confident proposals of a group in one step", async () => {
    renderWithQuery(<Cleansing />);
    const btn = await screen.findByTestId("cleansing-approve-group-MEINS");
    expect(btn).toHaveTextContent("2");
    fireEvent.click(btn);
    const approved = screen.getByTestId("cleansing-approved");
    expect(await within(approved).findByTestId("cleansing-approved-cq-2001")).toBeInTheDocument();
    expect(within(approved).getByTestId("cleansing-approved-cq-2002")).toBeInTheDocument();
    expect(within(approved).queryByTestId("cleansing-approved-cq-2003")).toBeNull();
  });

  it("rejects a proposal only with a reason", async () => {
    renderWithQuery(<Cleansing />);
    fireEvent.click(await screen.findByTestId("cleansing-open-TEL_NUMBER"));
    fireEvent.click(await screen.findByTestId("cleansing-reject-cq-2007"));
    const confirm = screen.getByTestId("cleansing-confirm-reject-cq-2007");
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByTestId("cleansing-reason-cq-2007"), { target: { value: "Not a South African number" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByTestId("cleansing-item-cq-2007")).toBeNull());
    expect(screen.getByTestId("cleansing-item-cq-2006")).toBeInTheDocument();
  });

  it("writes an approved proposal to SAP and offers the rollback", async () => {
    renderWithQuery(<Cleansing />);
    fireEvent.click(await screen.findByTestId("cleansing-apply-cq-2008"));
    await waitFor(() => expect(screen.queryByTestId("cleansing-approved-cq-2008")).toBeNull());
    expect(screen.getByTestId("cleansing-approved-cq-2009")).toBeInTheDocument();
    expect(await screen.findByTestId("cleansing-undo-cq-2008")).toBeEnabled();
  });
});
