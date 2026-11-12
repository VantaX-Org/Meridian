import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetDataRequests } from "@/lib/api/v2/fixtures/dataRequests";
import { DataRequests } from "../screens/DataRequests";
import { ToastProvider } from "../Toast";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

const perm = vi.hoisted(() => ({ assign: true }));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ ...m.useV2Session(), can: (a: string) => (a === "assign" ? perm.assign : true) }) };
});
vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/data-requests");
  resetDataRequests();
  perm.assign = true;
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("data requests", () => {
  it("owner fills the form, bad value is refused, good value is submitted", async () => {
    renderWithQuery(<ToastProvider><DataRequests /></ToastProvider>);
    fireEvent.click(await screen.findByTestId("dr-open-req-1"));
    const row = await screen.findByTestId("dr-row-item-1");
    expect(within(row).getByText("Material type")).toBeInTheDocument();
    fireEvent.change(within(row).getByTestId("dr-input-item-1"), { target: { value: "BAD" } });
    fireEvent.click(screen.getByTestId("dr-submit-req-1"));
    expect(await screen.findByTestId("dr-error-item-1")).toHaveTextContent("Use one of the allowed values");
    fireEvent.change(within(row).getByTestId("dr-input-item-1"), { target: { value: "ROH" } });
    fireEvent.click(screen.getByTestId("dr-submit-req-1"));
    await waitFor(() => expect(within(screen.getByTestId("dr-row-item-1")).queryByTestId("dr-input-item-1")).toBeNull());
  });

  it("steward sees progress and the create form", async () => {
    renderWithQuery(<ToastProvider><DataRequests /></ToastProvider>);
    expect(await screen.findByTestId("dr-sent-req-1")).toBeInTheDocument();
    expect(within(screen.getByTestId("dr-sent-req-1")).getByTestId("dr-progress-req-1")).toBeInTheDocument();
    expect(screen.getByTestId("dr-create")).toBeInTheDocument();
  });

  it("hides the create form without the assign permission", async () => {
    perm.assign = false;
    renderWithQuery(<ToastProvider><DataRequests /></ToastProvider>);
    expect(await screen.findByTestId("dr-mine")).toBeInTheDocument();
    expect(screen.queryByTestId("dr-create")).toBeNull();
  });
});
