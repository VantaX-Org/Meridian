import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { WorkRequestForm } from "../RequestForm";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("Request form (next)", () => {
  it("renders the form, or its permission, error or empty state", async () => {
    setUrl("/requests/new?fixture=1");
    renderWithQuery(<ToastProvider><WorkRequestForm /></ToastProvider>);
    const root = await screen.findByTestId("request-form");
    await waitFor(() => {
      const group = root.querySelector('[data-testid^="form-table-"]');
      const state = screen.queryByText(/permission|could not be loaded|no form fields/);
      expect(group ?? state).toBeTruthy();
    });
  });
});
