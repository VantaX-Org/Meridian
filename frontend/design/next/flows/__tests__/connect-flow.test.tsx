// The connect sheet's details step is the native OAuth form: no v2 form, no password field.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "../../kit";
import { ConnectFlow } from "../ConnectFlow";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "u", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const ctx = (step: number) => ({ id: "new", close: vi.fn(), dismiss: vi.fn(), under: undefined, step, setStep: vi.fn(), open: vi.fn() });

describe("ConnectFlow", () => {
  it("draws the native details form on step 2, with no password field", () => {
    renderWithQuery(<ToastProvider><ConnectFlow ctx={ctx(2) as never} /></ToastProvider>);
    expect(screen.getByTestId("connection-form")).toBeInTheDocument();
    expect(screen.getByText("OAuth client credentials")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Password/)).toBeNull();
    expect(document.querySelector(".nx-legacy")).toBeNull();
  });
});
