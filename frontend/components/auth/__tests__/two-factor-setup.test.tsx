// Setting up two-factor sign-in: a setup key, a confirming code, then the recovery codes shown once; and the
// guard that holds a user whose organisation requires it on the set-up screen.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import apiClient from "@/lib/api/client";
import * as authApi from "@/lib/api/auth";
import { LocalAuthProvider } from "@/context/auth-context";
import { AuthGuard } from "../auth-guard";
import { TwoFactorSetup, cleanCode, groupKey } from "../two-factor-setup";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/update-available-modal", () => ({ UpdateAvailableModal: () => null }));
vi.mock("@/context/update-modal-context", () => ({ UpdateModalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const SETUP = { secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/Meridian%3Aa%40example.test?secret=JBSW" };
const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-${String(i).padStart(4, "2")}`);

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("helpers", () => {
  it("groups the key in fours and strips spaces from a code", () => {
    expect(groupKey("JBSWY3DPEHPK")).toBe("JBSW Y3DP EHPK");
    expect(cleanCode(" 123 456 ")).toBe("123456");
  });
});

describe("TwoFactorSetup", () => {
  it("shows the key, checks the code, then holds the recovery codes until they are saved", async () => {
    vi.spyOn(authApi, "startTwoFactorSetup").mockResolvedValue(SETUP);
    const confirm = vi.spyOn(authApi, "confirmTwoFactor").mockResolvedValue({ recoveryCodes: CODES, token: "full" });
    const onConfirmed = vi.fn();
    const onDone = vi.fn();
    render(<TwoFactorSetup onConfirmed={onConfirmed} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: "Get a setup key" }));
    expect(await screen.findByTestId("two-factor-key")).toHaveTextContent("JBSW Y3DP EHPK 3PXP");
    expect(screen.getByRole("link", { name: "open the setup link" })).toHaveAttribute("href", SETUP.otpauth_uri);

    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(screen.getByText("Enter the 6-digit code your app shows.")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Code from the app"), { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("123456"));
    expect(onConfirmed).toHaveBeenCalledWith("full");

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    expect(list.querySelectorAll("li")).toHaveLength(10);
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I have saved my recovery codes"));
    fireEvent.click(done);
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the API's reason when the code is wrong", async () => {
    vi.spyOn(authApi, "startTwoFactorSetup").mockResolvedValue(SETUP);
    vi.spyOn(authApi, "confirmTwoFactor").mockRejectedValue(new AxiosError("422", "ERR", undefined, undefined, {
      status: 422, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
      data: { detail: "That code did not work. Check the time on your phone and enter the code now showing." },
    }));
    render(<TwoFactorSetup onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Get a setup key" }));
    fireEvent.change(await screen.findByLabelText("Code from the app"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText(/That code did not work/)).toBeInTheDocument();
  });
});

describe("AuthGuard when the organisation requires two-factor sign-in", () => {
  it("shows the set-up screen instead of the app, and the app once it is done", async () => {
    localStorage.setItem("mn_auth_token", "restricted");
    vi.spyOn(apiClient, "get").mockResolvedValue({
      data: { user: { id: "u1", email: "a@example.test", name: "Ana", role: "analyst", permissions: [] }, must_change_password: false, must_enrol_2fa: true },
    });
    vi.spyOn(authApi, "startTwoFactorSetup").mockResolvedValue(SETUP);
    vi.spyOn(authApi, "confirmTwoFactor").mockResolvedValue({ recoveryCodes: CODES, token: "full" });
    render(<LocalAuthProvider><AuthGuard><p>the app</p></AuthGuard></LocalAuthProvider>);

    expect(await screen.findByRole("heading", { name: "Set up two-factor sign-in to continue" })).toBeInTheDocument();
    expect(screen.queryByText("the app")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Get a setup key" }));
    fireEvent.change(await screen.findByLabelText("Code from the app"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    fireEvent.click(await screen.findByLabelText("I have saved my recovery codes"));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Meridian" }));
    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(localStorage.getItem("mn_auth_token")).toBe("full");
  });
});
