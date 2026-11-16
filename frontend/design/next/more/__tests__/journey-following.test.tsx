import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.shared = false;
});
import { Following } from "../Following";

describe("Following (next)", () => {
  it("lists subscriptions and watches, and stops a watch", async () => {
    wrap(<Following />);
    await waitFor(() => expect(within(screen.getByTestId("subscriptions")).getAllByRole("checkbox").length).toBeGreaterThan(0));
    await waitFor(() => expect(within(screen.getByTestId("watch-list")).getByRole("button", { name: "Stop watching" })).toBeTruthy());
    fireEvent.click(within(screen.getByTestId("watch-list")).getByRole("button", { name: "Stop watching" }));
    await waitFor(() => expect(within(screen.getByTestId("watch-list")).queryByRole("button", { name: "Stop watching" })).toBeNull());
  });

  it("keeps everything read only in a shared view", async () => {
    Q.shared = true;
    wrap(<Following />);
    await waitFor(() => expect(within(screen.getByTestId("subscriptions")).getAllByRole("checkbox").length).toBeGreaterThan(0));
    for (const c of within(screen.getByTestId("subscriptions")).getAllByRole("checkbox")) expect((c as HTMLInputElement).disabled).toBe(true);
  });
});
