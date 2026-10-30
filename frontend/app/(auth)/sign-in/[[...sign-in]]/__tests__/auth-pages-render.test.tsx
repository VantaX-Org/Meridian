// Smoke test: every signed-out page renders in the frame of the one interface (design/v2/auth).
import { fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sign-in",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ login: vi.fn(), user: null, logout: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/api/sso", () => ({
  getOidcPublicConfig: vi.fn().mockResolvedValue({ enabled: false, display_name: null, enforce: false }),
}));

vi.mock("@/lib/api/auth", () => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  acceptInvite: vi.fn(),
  getInvitePreview: vi.fn(),
}));

import SignInPage from "../page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import LicenceErrorPage from "@/app/(auth)/licence-error/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import AcceptInvitePage from "@/app/(auth)/accept-invite/page";

describe("signed-out pages render in the one frame", () => {
  it("sign-in renders exactly one h1 and no marketing copy", () => {
    const { container } = render(<SignInPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).not.toContain("800+");
  });

  it("sign-in shows the product name above one card on the ground, with no picture and no old classes", () => {
    const { container } = render(<SignInPage />);
    expect(container.querySelector("main.m2-auth .m2-auth-card h1")?.textContent).toBe("Sign in");
    expect(container.querySelector(".m2-auth-brand")?.textContent).toContain("Meridian");
    expect(container.querySelector("aside")).toBeNull();
    expect(container.querySelector("[class*='m-card'], [class*='m-motion']")).toBeNull();
  });

  it("forgot-password renders exactly one h1", () => {
    const { container } = render(<ForgotPasswordPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("licence-error renders exactly one h1", () => {
    const { container } = render(<LicenceErrorPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("reset-password renders exactly one h1", () => {
    const { container } = render(<ResetPasswordPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("accept-invite renders exactly one h1", () => {
    // InvitePreview (RBAC) queries the invite, so the page needs a QueryClient like the app root provides.
    const { container } = render(<QueryClientProvider client={new QueryClient()}><AcceptInvitePage /></QueryClientProvider>);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("password eye toggle exposes aria-pressed and flips the input type", () => {
    const { getByLabelText, container } = render(<SignInPage />);
    const toggle = getByLabelText("Show password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(getByLabelText("Hide password").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("input[type=text][autocomplete=current-password]")).not.toBeNull();
  });

  it("password error is tied to the input via aria-describedby", () => {
    const { getByRole, container } = render(<SignInPage />);
    fireEvent.click(getByRole("button", { name: "Sign in" }));
    fireEvent.submit(container.querySelector("form")!);
    const input = container.querySelector("input[autocomplete=current-password]")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const id = input.getAttribute("aria-describedby")!;
    expect(container.querySelector(`#${CSS.escape(id)}`)?.textContent).toBe("Enter your password");
  });
});
