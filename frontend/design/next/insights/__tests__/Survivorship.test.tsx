import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, deny: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));
const denied = () => Promise.reject({ response: { status: 403 } });

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.deny = false;
});
vi.mock("@/lib/api/v2/aletheia-survivorship", async (orig) => { const m = await orig<typeof import("@/lib/api/v2/aletheia-survivorship")>(); return { ...m, getSurvivorship: (...a: Parameters<typeof m.getSurvivorship>) => (Q.deny ? denied() : m.getSurvivorship(...a)) }; });
import { Survivorship } from "../Survivorship";

describe("Aletheia verified survivorship (next)", () => {
  // The reader case runs first: approving changes the in-memory fixture for the rest of the file.
  it("lets a reader see the queue without approving", async () => {
    Q.can = (a) => a !== "approve";
    wrap(<Survivorship />);
    await waitFor(() => expect(screen.getByTestId("surv-queue-reason")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Approve selected/ })).toBeNull();
  });
  it("renders the queue and approves the selected picks", async () => {
    wrap(<Survivorship />);
    await waitFor(() => expect(screen.getByTestId("survivorship-queue")).toBeTruthy());
    expect(screen.getByTestId("surv-steps")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: /Approve selected/ }));
    await waitFor(() => expect(screen.getByText(/picks? approved/)).toBeTruthy());
  });
  it("says so when the role cannot read the picks", async () => {
    Q.deny = true;
    wrap(<Survivorship />);
    await waitFor(() => expect(screen.getByText("Your role cannot read the survivorship picks.")).toBeTruthy());
  });
});
