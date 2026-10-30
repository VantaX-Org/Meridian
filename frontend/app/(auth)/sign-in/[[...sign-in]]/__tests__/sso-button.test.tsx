import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sign-in",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ login: vi.fn(), user: null, logout: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/sso", () => ({ getOidcPublicConfig: vi.fn() }));

import * as ssoApi from "@/lib/api/sso";
import { safeNext, ssoErrorSentence, ssoStartHref, takeSsoSession } from "@/design/v2/auth/sso";
import SignInPage from "../page";

const config = vi.mocked(ssoApi.getOidcPublicConfig);

beforeEach(() => {
  config.mockReset();
  window.history.replaceState(null, "", "/sign-in");
  localStorage.clear();
});

describe("sign-in with single sign-on", () => {
  it("shows only the password form when SSO is off", async () => {
    config.mockResolvedValue({ enabled: false, display_name: null, enforce: false });
    render(<SignInPage />);
    await waitFor(() => expect(config).toHaveBeenCalled());
    expect(screen.queryByText(/Continue with/)).toBeNull();
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
  });

  it("shows the password form when the config cannot be read", async () => {
    config.mockRejectedValue(new Error("down"));
    render(<SignInPage />);
    await waitFor(() => expect(config).toHaveBeenCalled());
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.queryByText(/Continue with/)).toBeNull();
  });

  it("puts Continue with <name> above the password form when enabled", async () => {
    config.mockResolvedValue({ enabled: true, display_name: "Corp login", enforce: false });
    render(<SignInPage />);
    const link = await screen.findByRole("link", { name: "Continue with Corp login" });
    expect(link).toHaveAttribute("href", "/api/v1/auth/oidc/start");
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(link.compareDocumentPosition(screen.getByLabelText("Work email")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries the page to return to", async () => {
    window.history.replaceState(null, "", "/sign-in?next=%2Fobjects%3Fa%3D1");
    config.mockResolvedValue({ enabled: true, display_name: "Corp login", enforce: false });
    render(<SignInPage />);
    expect(await screen.findByRole("link", { name: "Continue with Corp login" })).toHaveAttribute("href", "/api/v1/auth/oidc/start?next=%2Fobjects%3Fa%3D1");
  });

  it("hides the password form when enforced and reveals it behind Administrator sign-in", async () => {
    config.mockResolvedValue({ enabled: true, display_name: "Corp login", enforce: true });
    render(<SignInPage />);
    expect(await screen.findByRole("link", { name: "Continue with Corp login" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText("Work email")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Administrator sign-in" }));
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administrator sign-in" })).toBeNull();
  });

  it("explains a failed sign-in from the code, never from raw text in the address", async () => {
    window.history.replaceState(null, "", "/sign-in?sso_error=domain_not_allowed");
    config.mockResolvedValue({ enabled: true, display_name: "Corp login", enforce: false });
    const { unmount } = render(<SignInPage />);
    expect(await screen.findByText("Your email domain is not allowed to sign in here. Ask an administrator.")).toBeInTheDocument();
    unmount();
    window.history.replaceState(null, "", "/sign-in?sso_error=%3Cb%3Eclick%3C%2Fb%3E");
    render(<SignInPage />);
    expect(await screen.findByText("Single sign-on failed. Try again, or use your email and password.")).toBeInTheDocument();
    expect(screen.queryByText(/click/)).toBeNull();
  });
});

describe("sso helpers", () => {
  it("stores the session token from the fragment, clears it and returns a same-site page", () => {
    window.history.replaceState(null, "", "/sign-in#sso_token=abc.def.ghi&next=%2Fobjects");
    expect(takeSsoSession()).toBe("/objects");
    expect(localStorage.getItem("mn_auth_token")).toBe("abc.def.ghi");
    expect(window.location.hash).toBe("");
    expect(document.cookie).toContain("mn_session=1");
    expect(takeSsoSession()).toBeNull();
  });

  it("never navigates to an address it was handed", () => {
    for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "", null, undefined]) expect(safeNext(bad)).toBe("/");
    window.history.replaceState(null, "", "/sign-in#sso_token=t&next=https%3A%2F%2Fevil.test");
    expect(takeSsoSession()).toBe("/");
    expect(ssoStartHref("//evil.test")).toBe("/api/v1/auth/oidc/start");
    expect(ssoErrorSentence(null)).toBeNull();
  });
});
