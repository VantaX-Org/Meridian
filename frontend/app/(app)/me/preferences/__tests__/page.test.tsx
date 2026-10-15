import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { toast } from "sonner";
import { renderWithQuery } from "@/__tests__/render";
import * as health from "@/lib/api/health";
import * as notifications from "@/lib/api/notifications";
import { resetPreferencesCache, setPreferences } from "@/lib/preferences";
import type { HealthResponse } from "@/types/api";
import PreferencesPage from "../page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const HEALTH: HealthResponse = {
  status: "ok", version: "1.0.0", llm_provider: "ollama", llm_connected: false, licence: { valid: true },
  email_backend: "smtp", timestamp: "2026-10-15T08:00:00+00:00",
};

const NOTICE = "Email is not configured on this deployment; you will get in-app notifications only";

function stubHealth(backend: HealthResponse["email_backend"]) {
  return vi.spyOn(health, "getHealth").mockResolvedValue({ ...HEALTH, email_backend: backend });
}

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesCache();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("Preferences page", () => {
  it("shows display, notification and guidance cards", async () => {
    stubHealth("smtp");
    renderWithQuery(<PreferencesPage />);
    expect(screen.getByText("Display")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Guidance and saved views")).toBeInTheDocument();
    expect(screen.getByText("Digest of your open items")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Tell me at once about critical findings" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Also email me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send me a test" })).toBeInTheDocument();
    await waitFor(() => expect(health.getHealth).toHaveBeenCalled());
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("reads absent notification settings as off and stores each switch under notifications", () => {
    stubHealth("smtp");
    renderWithQuery(<PreferencesPage />);
    const critical = screen.getByRole("switch", { name: "Tell me at once about critical findings" });
    const email = screen.getByRole("switch", { name: "Also email me" });
    expect(critical).toHaveAttribute("aria-checked", "false");
    expect(email).toHaveAttribute("aria-checked", "false");

    fireEvent.click(critical);
    fireEvent.click(email);
    const stored = JSON.parse(window.localStorage.getItem("meridian:prefs") ?? "{}");
    expect(stored.notifications).toEqual({ immediate_critical: true, channels: { email: true } });
    expect(critical).toHaveAttribute("aria-checked", "true");
    expect(email).toHaveAttribute("aria-checked", "true");
  });

  it("shows the stored choices", () => {
    stubHealth("smtp");
    setPreferences({ notifications: { digest: "weekly", immediate_critical: true, channels: { email: true } } });
    renderWithQuery(<PreferencesPage />);
    expect(screen.getByRole("switch", { name: "Tell me at once about critical findings" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Also email me" })).toHaveAttribute("aria-checked", "true");
  });

  it("tells the user when email is not configured on the deployment", async () => {
    stubHealth(null);
    renderWithQuery(<PreferencesPage />);
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(NOTICE);
  });
});

describe("Send me a test", () => {
  it("toasts success when the email went out", async () => {
    stubHealth("smtp");
    const send = vi.spyOn(notifications, "sendTestNotification").mockResolvedValue({ email: "sent", in_app: true });
    renderWithQuery(<PreferencesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Test sent to your email and your inbox"));
  });

  it("says the test is in-app only when there is no email backend", async () => {
    stubHealth(null);
    vi.spyOn(notifications, "sendTestNotification").mockResolvedValue({ email: "no_backend", in_app: true });
    renderWithQuery(<PreferencesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Test sent to your inbox; email is not configured here"));
  });

  it("reports a failed email send as an error", async () => {
    stubHealth("resend");
    vi.spyOn(notifications, "sendTestNotification").mockResolvedValue({ email: "failed", in_app: true });
    renderWithQuery(<PreferencesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The email could not be sent; the test is in your inbox"));
  });

  it("explains the hourly limit on a 429", async () => {
    stubHealth("smtp");
    const err = new AxiosError("Too many requests", "429", undefined, undefined, {
      status: 429, statusText: "Too Many Requests", headers: {}, config: { headers: new AxiosHeaders() },
      data: { detail: { error: "rate_limited", limit: 3, window_s: 3600 } },
    });
    vi.spyOn(notifications, "sendTestNotification").mockRejectedValue(err);
    renderWithQuery(<PreferencesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Send me a test" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("You can send three tests an hour; try again later"));
  });
});
