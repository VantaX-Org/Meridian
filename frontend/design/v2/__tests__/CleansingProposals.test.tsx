import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetCleaningFixture } from "@/lib/api/v2/fixtures/cleaning";
import { Cleansing } from "../screens/Cleansing";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";
import * as cleaning from "@/lib/api/v2/cleaning";

const h = vi.hoisted(() => ({ allowed: "all" as "all" | string[] }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ ...m.useV2Session(), can: (a: string) => h.allowed === "all" || h.allowed.includes(a) }) };
});
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  h.allowed = "all";
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

  it("leaves the change the user approved for a second person to mark loaded", async () => {
    renderWithQuery(<Cleansing />);
    fireEvent.click(await screen.findByTestId("cleansing-approve-group-MEINS"));
    expect(await screen.findByTestId("cleansing-second-cq-2001")).toHaveTextContent("Waits for a second person");
    expect(screen.queryByTestId("cleansing-apply-cq-2001")).toBeNull();
    expect(screen.getByTestId("cleansing-apply-cq-2008")).toBeInTheDocument();
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

  it("marks a proposal another steward approved as loaded and offers the undo", async () => {
    renderWithQuery(<Cleansing />);
    fireEvent.click(await screen.findByTestId("cleansing-apply-cq-2008"));
    await waitFor(() => expect(screen.queryByTestId("cleansing-approved-cq-2008")).toBeNull());
    expect(screen.getByTestId("cleansing-approved-cq-2009")).toBeInTheDocument();
    expect(await screen.findByTestId("cleansing-undo-cq-2008")).toBeEnabled();
  });

  it("says when to come back if nothing has been cleansed yet", async () => {
    vi.spyOn(cleaning, "getCleaningMetrics").mockResolvedValue({ metrics: [] } as never);
    renderWithQuery(<Cleansing />);
    expect(await screen.findByText(/Nothing has been cleansed yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("flow-steps")).toBeNull();
  });

  it("gives a retry when the cleansing figures cannot be read", async () => {
    vi.spyOn(cleaning, "getCleaningMetrics").mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    renderWithQuery(<Cleansing />);
    expect(await screen.findByText("The cleansing figures could not be read.", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("hides approve and apply when the role cannot approve or apply", async () => {
    h.allowed = [];
    renderWithQuery(<Cleansing />);
    await screen.findByTestId("cleansing-proposals");
    expect(screen.queryByTestId("cleansing-approve-group-MEINS")).toBeNull();
    expect(screen.queryAllByTestId(/^cleansing-apply-/)).toHaveLength(0);
  });
});
