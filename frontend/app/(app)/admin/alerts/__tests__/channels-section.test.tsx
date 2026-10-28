import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as notificationsApi from "@/lib/api/notifications";
import type { AlertChannel } from "@/lib/api/notifications";
import { ChannelsSection } from "../channels-section";


const CHANNEL: AlertChannel = {
  id: "c1", kind: "teams", target: "https://hooks.example/abc", digest: "weekly", immediate_critical: true,
  enabled: true, created_at: "2026-10-01T00:00:00Z", has_secret: false,
};

describe("alerts channels section, the one channel manager", () => {
  it("names the kind and digest in words", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    renderWithQuery(<ChannelsSection canEdit />);
    expect(await screen.findByText("Microsoft Teams")).toBeInTheDocument();
    expect(screen.getByText("Weekly digest")).toBeInTheDocument();
    expect(screen.queryByText("teams")).toBeNull();
  });

  it("removes a channel only after the confirmation", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    const del = vi.spyOn(notificationsApi, "deleteAlertChannel").mockResolvedValue();
    renderWithQuery(<ChannelsSection canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: /Actions for Microsoft Teams channel/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Remove channel" }));
    await waitFor(() => expect(del.mock.calls[0]?.[0]).toBe("c1"));
  });
});
