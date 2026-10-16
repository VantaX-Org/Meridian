// frontend/components/auth/auth-guard.test.tsx
// A failed session check signs the user out only on a 401; a 5xx or a network failure keeps the token
// and shows an error with Retry, so a server hiccup never throws everyone back to the sign-in page.
import { AxiosError, AxiosHeaders } from "axios";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { LocalAuthProvider } from "@/context/auth-context";
import { AuthGuard } from "./auth-guard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/force-password-change", () => ({ ForcePasswordChange: () => <p>change password</p> }));
vi.mock("@/components/update-available-modal", () => ({ UpdateAvailableModal: () => null }));
vi.mock("@/context/update-modal-context", () => ({ UpdateModalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const TOKEN_KEY = "mn_auth_token";
const USER = { id: "u1", email: "a@example.test", name: "Ana", role: "analyst", permissions: [] };

function httpError(status: number) {
  return new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, {
    status, data: {}, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
  });
}

function mount() {
  return render(
    <LocalAuthProvider>
      <AuthGuard><p>the app</p></AuthGuard>
    </LocalAuthProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
  localStorage.setItem(TOKEN_KEY, "tok");
});

describe("AuthGuard session check", () => {
  it("renders the app when the stored token is valid", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: { user: USER, must_change_password: false } });
    mount();
    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("signs out and goes to sign-in on a 401", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(httpError(401));
    mount();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("signs out on a 403 as well: the server has judged the token", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(httpError(403));
    mount();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("keeps the token and shows an error with Retry on a 5xx, then recovers on retry", async () => {
    const get = vi.spyOn(apiClient, "get")
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce({ data: { user: USER, must_change_password: false } });
    mount();
    expect(await screen.findByText("Could not check your session.")).toBeInTheDocument();
    expect(screen.getByText("The server answered 503 while checking your session.")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("treats a network failure like a server failure, not a sign-out", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    mount();
    expect(await screen.findByText("Could not reach the server to check your session.")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to sign-in when there is no stored token", async () => {
    localStorage.removeItem(TOKEN_KEY);
    const get = vi.spyOn(apiClient, "get");
    mount();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    expect(get).not.toHaveBeenCalled();
  });
});
