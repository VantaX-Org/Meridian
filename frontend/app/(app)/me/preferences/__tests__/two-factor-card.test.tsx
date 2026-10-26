import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as auth from "@/lib/api/auth";
import { TwoFactorCard } from "../two-factor-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe("TwoFactorCard", () => {
  it("offers set-up when it is off", async () => {
    vi.spyOn(auth, "getTwoFactorStatus").mockResolvedValue({ enabled: false, required: false, recovery_codes_left: 0 });
    const start = vi.spyOn(auth, "startTwoFactorSetup").mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/x" });
    renderWithQuery(<TwoFactorCard />);
    expect(await screen.findByText("Off")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    fireEvent.click(screen.getByRole("button", { name: "Get a setup key" }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(await screen.findByLabelText("Code from the app")).toBeInTheDocument();
  });

  it("turns it off with the password and a code", async () => {
    vi.spyOn(auth, "getTwoFactorStatus").mockResolvedValue({ enabled: true, required: false, recovery_codes_left: 8 });
    const off = vi.spyOn(auth, "disableTwoFactor").mockResolvedValue("new-token");
    renderWithQuery(<TwoFactorCard />);
    expect(await screen.findByText("You have 8 unused recovery codes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "the-password" } });
    fireEvent.change(screen.getByLabelText("Code from the app or a recovery code"), { target: { value: " 123 456 " } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(off).toHaveBeenCalledWith("the-password", "123456"));
  });

  it("cannot be turned off while the organisation requires it", async () => {
    vi.spyOn(auth, "getTwoFactorStatus").mockResolvedValue({ enabled: true, required: true, recovery_codes_left: 1 });
    renderWithQuery(<TwoFactorCard />);
    expect(await screen.findByText(/Your organisation requires two-factor sign-in, so it stays on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
    expect(screen.getByText(/Ask an administrator to reset two-factor sign-in before you run out/)).toBeInTheDocument();
  });
});
