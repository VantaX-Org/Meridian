import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

import { Evidence } from "../Evidence";

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Aletheia evidence (next)", () => {
  it("renders the evidence screen and points to verified survivorship", () => {
    wrap(<Evidence />);
    expect(screen.getByTestId("ins-evidence")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open verified survivorship" });
    expect(link.getAttribute("href")).toBe("/more/aletheia?tab=survivorship");
  });
  // No permission gate: the screen reads no API, so there is nothing to deny.
});
