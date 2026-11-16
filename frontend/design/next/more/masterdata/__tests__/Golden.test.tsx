import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/mdm-health";
import { ToastProvider } from "../../../kit";
import { GoldenHealth } from "../Golden";

const Q = vi.hoisted(() => ({ can: (() => true) as (p: string) => boolean }));
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = () => renderWithQuery(<ToastProvider><GoldenHealth /></ToastProvider>);
beforeEach(() => { Q.can = () => true; setUrl("/more?fixture=1"); window.sessionStorage.setItem("mn_v2_fixture", "1"); });
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("Golden records health (native)", () => {
  it("renders the fixture snapshot with the four weighted shares", async () => {
    wrap();
    expect((await screen.findByTestId("mdm-banner")).textContent).toMatch(/out of 100/);
    const parts = screen.getByTestId("mdm-parts");
    await waitFor(() => expect(within(parts).getAllByRole("row").length).toBeGreaterThanOrEqual(5));
  });

  it("links on to the issues", async () => {
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: "Open the issues" }));
    expect(getUrl()).toMatch(/^\/issues/);
  });

  it("says a 403 cannot be read", async () => {
    Q.can = () => false;
    vi.spyOn(api, "getMdmHealth").mockRejectedValue({ response: { status: 403 } });
    wrap();
    expect(await screen.findByText("Your role cannot read the MDM health figures.")).toBeInTheDocument();
    expect(screen.queryByTestId("mdm-banner")).toBeNull();
  });
});
