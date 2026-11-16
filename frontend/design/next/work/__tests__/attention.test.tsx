import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { WorkAttention, kindText } from "../Attention";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  setUrl("/work?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Action centre (next)", () => {
  it("lists what needs attention natively, links each row and filters by kind", async () => {
    renderWithQuery(<WorkAttention />);
    const table = await screen.findByRole("table", { name: /Act on these/ });
    await waitFor(() => expect(within(table).getByText("14 fixes wait for your approval")).toBeTruthy());
    expect(screen.getByText("10 things need you")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "Review approvals" }).getAttribute("href")).toContain("/work?filter=approvals");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "connection" } });
    await waitFor(() => expect(within(screen.getByRole("table", { name: /Act on these/ })).queryByText("14 fixes wait for your approval")).toBeNull());
    expect(screen.getByText("SuccessFactors cannot be reached")).toBeTruthy();
  });

  it("names every kind and keeps an unknown one as given", () => {
    expect(kindText("approvals")).toBe("Fixes waiting for approval");
    expect(kindText("unknown_kind")).toBe("unknown_kind");
  });
});
