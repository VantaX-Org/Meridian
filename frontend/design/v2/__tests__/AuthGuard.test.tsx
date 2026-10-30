// frontend/design/v2/__tests__/AuthGuard.test.tsx
// A failed session check signs the user out only on a 401; a 5xx or a network failure keeps the token
// and shows an error with Retry, so a server hiccup never throws everyone back to the sign-in page.
import { AxiosError, AxiosHeaders } from "axios";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { LocalAuthProvider } from "@/context/auth-context";
import { AuthGuard, STUCK_MS } from "../auth/Guard";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
    expect(await screen.findByText("Could not check your session: The server answered 503 while checking your session.")).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("treats a network failure like a server failure, not a sign-out", async () => {
    vi.spyOn(apiClient, "get").mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));
    mount();
    expect(await screen.findByText(/Could not reach the server to check your session/)).toBeInTheDocument();
    expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
    expect(push).not.toHaveBeenCalled();
  });

  it("marks the loading screen busy, and turns a session check that never answers into an error with Retry", async () => {
    vi.useFakeTimers();
    try {
      const get = vi.spyOn(apiClient, "get")
        .mockReturnValueOnce(new Promise(() => {}))
        .mockResolvedValueOnce({ data: { user: USER, must_change_password: false } });
      mount();
      const loading = screen.getByRole("status", { name: "Loading Meridian" });
      expect(loading).toHaveAttribute("aria-busy", "true");
      await act(async () => { vi.advanceTimersByTime(STUCK_MS); });
      expect(screen.getByText(/^This is taking longer than expected\./)).toBeInTheDocument();
      expect(localStorage.getItem(TOKEN_KEY)).toBe("tok");
      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      // The retry starts a fresh check with a fresh timeout, and recovers.
      await act(async () => { await Promise.resolve(); });
      vi.useRealTimers();
      expect(await screen.findByText("the app")).toBeInTheDocument();
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes to sign-in when there is no stored token", async () => {
    localStorage.removeItem(TOKEN_KEY);
    const get = vi.spyOn(apiClient, "get");
    mount();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
    expect(get).not.toHaveBeenCalled();
  });
});

describe("the forced password change", () => {
  it("shows instead of the app while the account still has its default password", async () => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ data: { user: USER, must_change_password: true } });
    mount();
    expect(await screen.findByRole("heading", { name: "Change your password to continue" })).toBeInTheDocument();
    expect(screen.queryByText("the app")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use at least 12 characters");
  });
});
