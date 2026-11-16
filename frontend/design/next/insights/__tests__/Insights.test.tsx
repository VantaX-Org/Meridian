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
vi.mock("@/lib/api/v2/insights", async (orig) => { const m = await orig<typeof import("@/lib/api/v2/insights")>(); return { ...m, getProvenCost: (...a: Parameters<typeof m.getProvenCost>) => (Q.deny ? denied() : m.getProvenCost(...a)) }; });
import { Insights } from "../Insights";

describe("Cost and causes (next)", () => {
  it("renders cost, causes, exec read, cleansing and owners from the fixture", async () => {
    wrap(<Insights />);
    await waitFor(() => expect(screen.getByTestId("ins-banner")).toBeTruthy());
    expect(screen.getByTestId("ins-causes")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("ins-exec")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("ins-cleansing")).toBeTruthy());
  });
  it("shows one duplicate cluster for a golden record", async () => {
    wrap(<Insights />);
    await waitFor(() => expect(screen.getByTestId("ins-duplicates")).toBeTruthy());
    fireEvent.change(screen.getByTestId("ins-dup-object"), { target: { value: "material_master" } });
    fireEvent.change(screen.getByTestId("ins-dup-record"), { target: { value: "0b9d7f0e-1c1a-4c55-9a43-2f6a1d1e5b10" } });
    fireEvent.click(screen.getByTestId("ins-dup-show"));
    await waitFor(() => expect(screen.getByTestId("ins-dup-summary").textContent).toMatch(/2 records, 1 links/));
    expect(screen.getByText("Needs a steward review")).toBeTruthy();
  });
  it("says so when the role cannot read the cost", async () => {
    Q.deny = true;
    wrap(<Insights />);
    await waitFor(() => expect(screen.getByText("Your role cannot read what bad data costs.")).toBeTruthy());
  });
});
