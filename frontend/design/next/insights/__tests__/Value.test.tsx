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
vi.mock("@/lib/api/v2/analytics", async (orig) => { const m = await orig<typeof import("@/lib/api/v2/analytics")>(); return { ...m, getValue: (...a: Parameters<typeof m.getValue>) => (Q.deny ? denied() : m.getValue(...a)) }; });
import { Value } from "../Value";

describe("Value delivered (next)", () => {
  it("renders the impact and reads the guards for a picked node", async () => {
    wrap(<Value />);
    await waitFor(() => expect(screen.getByTestId("val-banner")).toBeTruthy());
    expect(screen.getByTestId("val-impact")).toBeTruthy();
    const pick = await screen.findByTestId("val-guards-node");
    const opts = (pick as HTMLSelectElement).options;
    fireEvent.change(pick, { target: { value: opts[opts.length - 1].value } });
    await waitFor(() => expect(screen.getByTestId("val-guards")).toBeTruthy());
  });
  it("says so when the role cannot read the value", async () => {
    Q.deny = true;
    wrap(<Value />);
    await waitFor(() => expect(screen.getByText("Your role cannot read the value delivered.")).toBeTruthy());
  });
});
