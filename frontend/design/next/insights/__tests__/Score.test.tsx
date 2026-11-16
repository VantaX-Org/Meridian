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
vi.mock("@/lib/api/v2/score", async (orig) => { const m = await orig<typeof import("@/lib/api/v2/score")>(); return { ...m, getScoreHistory: (...a: Parameters<typeof m.getScoreHistory>) => (Q.deny ? denied() : m.getScoreHistory(...a)) }; });
import { Score } from "../Score";

describe("Score history (next)", () => {
  it("renders the trend, runs and modules, each module linked to its object", async () => {
    wrap(<Score />);
    await waitFor(() => expect(screen.getByTestId("sl-banner")).toBeTruthy());
    expect(screen.getByTestId("sl-trend")).toBeTruthy();
    const link = (await screen.findAllByTestId("sl-module-link"))[0];
    expect(link.getAttribute("href")).toMatch(/^\/objects\?module=/);
  });
  it("says so when the role cannot read the score history", async () => {
    Q.deny = true;
    wrap(<Score />);
    await waitFor(() => expect(screen.getByText("Your role cannot read the score history.")).toBeTruthy());
  });
});
