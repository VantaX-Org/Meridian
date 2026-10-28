import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as notificationsApi from "@/lib/api/notifications";
import type { AlertChannel } from "@/lib/api/notifications";
import { AlertChannelsPanel } from "../alert-channels-panel";

const CHANNEL: AlertChannel = {
  id: "c1", kind: "slack", target: "hooks.example", digest: "daily", immediate_critical: true,
  enabled: true, created_at: "2026-10-01T00:00:00Z", has_secret: false,
};

// Channels are listed, tested, added and removed on Admin › Alerts (admin/alerts/__tests__); this section links there.
describe("AlertChannelsPanel", () => {
  it("counts the channels and links to the one channel manager", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([CHANNEL]);
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("1 channel set up")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Manage channels" })).toHaveAttribute("href", "/admin/alerts");
  });

  it("says when there is no channel yet", async () => {
    vi.spyOn(notificationsApi, "getAlertChannels").mockResolvedValue([]);
    renderWithQuery(<AlertChannelsPanel />);
    await waitFor(() => expect(screen.getByText("No alert channel yet")).toBeInTheDocument());
  });
});
