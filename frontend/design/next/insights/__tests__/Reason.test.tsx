import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
vi.mock("@/lib/api/v2/aletheia-engine", async (orig) => { const m = await orig<typeof import("@/lib/api/v2/aletheia-engine")>(); return { ...m, getReason: (...a: Parameters<typeof m.getReason>) => (Q.deny ? denied() : m.getReason(...a)) }; });
import { Reason } from "../Reason";

describe("Aletheia reasoning (next)", () => {
  it("renders anomalies and causal risks with evidence from the fixture", async () => {
    wrap(<Reason />);
    await waitFor(() => expect(screen.getByTestId("rs-banner")).toBeTruthy());
    expect(screen.getByTestId("rs-anomalies")).toBeTruthy();
    expect(screen.getByTestId("rs-risks")).toBeTruthy();
    expect(screen.getByTestId("rs-engine")).toBeTruthy();
  });
  it("says so when the role cannot read the reasoning", async () => {
    Q.deny = true;
    wrap(<Reason />);
    await waitFor(() => expect(screen.getByText("Your role cannot read the Aletheia reasoning.")).toBeTruthy());
  });
});
