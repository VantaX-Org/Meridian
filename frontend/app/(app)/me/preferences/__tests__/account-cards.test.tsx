import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithQuery } from "@/__tests__/render";
import * as auth from "@/lib/api/auth";
import * as notifications from "@/lib/api/notifications";
import { DeliveriesCard, PasswordCard } from "../account-cards";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
}

describe("PasswordCard", () => {
  it("refuses a short or mismatched password without calling the API", () => {
    const spy = vi.spyOn(auth, "changeOwnPassword").mockResolvedValue("new-token");
    renderWithQuery(<PasswordCard />);
    fill("old-password-1", "short", "short");
    expect(screen.getByText("The new password needs at least 12 characters.")).toBeInTheDocument();
    fill("old-password-1", "a-long-new-password", "a-different-password");
    expect(screen.getByText("The new password and its confirmation do not match.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the current and new password and clears the form", async () => {
    const spy = vi.spyOn(auth, "changeOwnPassword").mockResolvedValue("new-token");
    renderWithQuery(<PasswordCard />);
    fill("old-password-1", "a-long-new-password", "a-long-new-password");
    await waitFor(() => expect(spy).toHaveBeenCalledWith("old-password-1", "a-long-new-password"));
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveValue(""));
  });

  it("shows the API's reason when the current password is wrong", async () => {
    const err = new AxiosError("422", "ERR", undefined, undefined, {
      status: 422, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
      data: { detail: "Current password is incorrect" },
    });
    vi.spyOn(auth, "changeOwnPassword").mockRejectedValue(err);
    renderWithQuery(<PasswordCard />);
    fill("wrong-password", "a-long-new-password", "a-long-new-password");
    expect(await screen.findByText(/Current password is incorrect/)).toBeInTheDocument();
  });
});

describe("DeliveriesCard", () => {
  it("lists the caller's deliveries with their result", async () => {
    vi.spyOn(notifications, "getMyDeliveries").mockResolvedValue([
      { id: "d1", channel: "email", kind: "digest", status: "sent", error: null, created_at: "2026-10-20T08:00:00Z" },
      { id: "d2", channel: "in_app", kind: "critical", status: "failed", error: "boom", created_at: "2026-10-19T08:00:00Z" },
    ]);
    renderWithQuery(<DeliveriesCard />);
    expect(await screen.findByText("Digest")).toBeInTheDocument();
    expect(screen.getByText("Critical finding")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(notifications.getMyDeliveries).toHaveBeenCalledWith(20);
  });

  it("says when nothing has been sent", async () => {
    vi.spyOn(notifications, "getMyDeliveries").mockResolvedValue([]);
    renderWithQuery(<DeliveriesCard />);
    expect(await screen.findByText(/Nothing has been sent to you yet/)).toBeInTheDocument();
    expect(screen.getByText(/send yourself a test above/)).toBeInTheDocument();
  });

  it("shows a skeleton while loading, then an error with Retry that reads the history again", async () => {
    const err = new AxiosError("500", "ERR", undefined, undefined, {
      status: 500, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: { detail: "Database unavailable" },
    });
    const get = vi.spyOn(notifications, "getMyDeliveries").mockRejectedValueOnce(err).mockResolvedValue([]);
    renderWithQuery(<DeliveriesCard />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByText("The delivery history did not load.")).toBeInTheDocument();
    expect(screen.getByText("Database unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Nothing has been sent to you yet/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });
});
