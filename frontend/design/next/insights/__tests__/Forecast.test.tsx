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
vi.mock("@/lib/api/v2/analytics", async (orig) => { const m = await orig<typeof import("@/lib/api/v2/analytics")>(); return { ...m, getPredictive: (...a: Parameters<typeof m.getPredictive>) => (Q.deny ? denied() : m.getPredictive(...a)) }; });
import { Forecast } from "../Forecast";

describe("Forecast (next)", () => {
  it("renders the forecast and replans sprints when the hours change", async () => {
    wrap(<Forecast />);
    await waitFor(() => expect(screen.getByTestId("fc-banner")).toBeTruthy());
    const hours = await screen.findByTestId("fc-sprint-hours");
    fireEvent.change(hours, { target: { value: "80" } });
    expect((hours as HTMLSelectElement).value).toBe("80");
    await waitFor(() => expect(screen.getByTestId("fc-sprints")).toBeTruthy());
  });
  it("says so when the role cannot read the forecast", async () => {
    Q.deny = true;
    wrap(<Forecast />);
    await waitFor(() => expect(screen.getByText("Your role cannot read the forecast.")).toBeTruthy());
  });
});
