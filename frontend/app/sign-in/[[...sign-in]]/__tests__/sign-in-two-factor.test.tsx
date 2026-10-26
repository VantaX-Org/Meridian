// Signing in to an account with two-factor sign-in: the password step, then a code from the app or a recovery code.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sign-in",
  useSearchParams: () => new URLSearchParams(),
}));

const auth = vi.hoisted(() => ({ login: vi.fn(), verifyCode: vi.fn() }));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ ...auth, user: null, logout: vi.fn() }) }));

import SignInPage from "../page";

function httpError(status: number, detail: string) {
  return new AxiosError(String(status), "ERR", undefined, undefined, {
    status, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: { detail },
  });
}

async function passwordStep() {
  auth.login.mockResolvedValue({ status: "mfa_required", mfaToken: "pending" });
  render(<SignInPage />);
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ana@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "the-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("heading", { name: "Enter your code" })).toBeInTheDocument();
}

beforeEach(() => {
  push.mockClear();
  auth.login.mockReset();
  auth.verifyCode.mockReset();
});

describe("sign-in with two-factor sign-in", () => {
  it("asks for the code after the password and signs in with it", async () => {
    await passwordStep();
    expect(push).not.toHaveBeenCalled();
    auth.verifyCode.mockResolvedValue({ id: "u1" });
    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter the 6-digit code")).toBeInTheDocument();
    expect(auth.verifyCode).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.verifyCode).toHaveBeenCalledWith("pending", "123456"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/home"));
  });

  it("says when the code is wrong and stays on the code step", async () => {
    await passwordStep();
    auth.verifyCode.mockRejectedValue(httpError(422, "That code did not work. Check the time on your phone, or use a recovery code."));
    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/That code did not work/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Enter your code" })).toBeInTheDocument();
  });

  it("takes a recovery code", async () => {
    await passwordStep();
    auth.verifyCode.mockResolvedValue({ id: "u1" });
    fireEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    fireEvent.change(screen.getByLabelText("Recovery code"), { target: { value: "ABCD-EFGH-JKLM-NPQR" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(auth.verifyCode).toHaveBeenCalledWith("pending", "ABCD-EFGH-JKLM-NPQR"));
  });

  it("goes back to the password step when the sign-in timed out", async () => {
    await passwordStep();
    auth.verifyCode.mockRejectedValue(httpError(400, "Your sign-in timed out. Enter your email and password again."));
    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Your sign-in timed out. Enter your email and password again.")).toBeInTheDocument();
  });

  it("signs straight in when the account has no two-factor sign-in", async () => {
    auth.login.mockResolvedValue({ status: "signed_in", user: { id: "u1" } });
    render(<SignInPage />);
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "the-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/home"));
  });
});
