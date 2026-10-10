import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as notificationsApi from "@/lib/api/notifications";
import type { AlertChannel } from "@/lib/api/notifications";
import { AlertChannelsPanel } from "../alert-channels-panel";

const CHANNEL: AlertChannel = {
  id: "c1", kind: "slack", target: "hooks.example", digest: "daily", immediate_critical: true,
  enabled: true, created_at: "2026-10-01T00:00:00Z", has_secret: false,
};

describe("AlertChannelsPanel", () => {
  it("lists channels and sends a test alert", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    const test = vi.spyOn(notificationsApi, "testAlertChannel").mockResolvedValue({ delivered: true });
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("hooks.example")).toBeInTheDocument());
    expect(within(screen.getByRole("table")).getByText("Daily digest")).toBeInTheDocument();
    expect(screen.getByText("Immediate")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await waitFor(() => expect(test.mock.calls[0]?.[0]).toBe("c1"));
  });

  it("adds a channel with the defaults", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
    const create = vi.spyOn(notificationsApi, "createAlertChannel").mockResolvedValue(CHANNEL);
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("No alert channel yet.")).toBeInTheDocument());
    const add = screen.getByRole("button", { name: "Add channel" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: " https://hooks.example/abc " } });
    fireEvent.click(add);
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      kind: "slack", target: "https://hooks.example/abc", secret: undefined, digest: "daily", immediate_critical: false,
    }));
  });

  it("removes a channel", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    const del = vi.spyOn(notificationsApi, "deleteAlertChannel").mockResolvedValue();
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("hooks.example")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep channel" }));
    expect(screen.queryByRole("button", { name: "Confirm remove" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
    await waitFor(() => expect(del.mock.calls[0]?.[0]).toBe("c1"));
    expect(del).toHaveBeenCalledTimes(1);
  });
});
