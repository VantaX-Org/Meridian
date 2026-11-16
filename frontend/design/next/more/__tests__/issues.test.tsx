import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/issues";
import { ToastProvider } from "../../kit";
import { Issues } from "../Issues";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = (el: ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/issues?status=all");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Record issues", () => {
  it("shows the banner, the status panel and the table", async () => {
    wrap(<Issues />);
    expect(await screen.findByTestId("issues-banner")).toBeInTheDocument();
    expect(await screen.findByTestId("issues-status")).toBeInTheDocument();
    expect(screen.getByTestId("issues-filter")).toBeInTheDocument();
    expect(await screen.findByTestId("issues-table")).toBeInTheDocument();
  });

  it("shows the empty state when no issue matches", async () => {
    vi.spyOn(api, "getIssues").mockResolvedValue({ counts: {}, items: [], total: 0 });
    wrap(<Issues />);
    expect(await screen.findByText("No issues match. Change the status or the filter.")).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getIssues").mockRejectedValue(new Error("down"));
    wrap(<Issues />);
    expect(await screen.findByText("The record issues could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("issues-banner")).toBeInTheDocument();
  });
});
