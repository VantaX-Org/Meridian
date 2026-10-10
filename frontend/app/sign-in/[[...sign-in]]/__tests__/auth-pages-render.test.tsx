// Smoke test: every signed-out page still renders after the AuthFrame redesign (T5).
import { render } from "@testing-library/react";
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

vi.mock("@/lib/api/auth", () => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  acceptInvite: vi.fn(),
}));

import SignInPage from "../page";
import ForgotPasswordPage from "@/app/forgot-password/page";
import LicenceErrorPage from "@/app/licence-error/page";
import ResetPasswordPage from "@/app/reset-password/page";
import AcceptInvitePage from "@/app/accept-invite/page";

describe("signed-out pages render with the redesigned AuthFrame", () => {
  it("sign-in renders exactly one h1 and the brand panel copy", () => {
    const { container } = render(<SignInPage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.textContent).toContain("Your SAP data stays on this server.");
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
    const { container } = render(<AcceptInvitePage />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
