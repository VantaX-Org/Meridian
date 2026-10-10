import apiClient from "./client";
import type {
  NotificationListResponse,
  UnreadCountResponse,
} from "@/types/api";

export async function getNotifications(params?: {
  is_read?: boolean;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<NotificationListResponse> {
  const { data } = await apiClient.get<NotificationListResponse>(
    "/api/v1/notifications",
    { params }
  );
  return data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.put(`/api/v1/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await apiClient.put("/api/v1/notifications/read-all");
}

export async function getUnreadCount(): Promise<number> {
  const { data } = await apiClient.get<UnreadCountResponse>(
    "/api/v1/notifications/unread-count"
  );
  return data.count;
}

/* ─── Alert channels (outbound webhook / Slack / Teams / email) ─── */

export type AlertChannelKind = "webhook" | "slack" | "teams" | "email";
export type AlertDigest = "daily" | "weekly" | "off";

/** A channel as listed: webhook targets are redacted to the host; the secret is never returned. */
export interface AlertChannel {
  id: string;
  kind: AlertChannelKind;
  target: string;
  digest: AlertDigest;
  immediate_critical: boolean;
  enabled: boolean;
  created_at: string;
  has_secret: boolean;
}

export interface AlertChannelCreate {
  kind: AlertChannelKind;
  target: string;
  /** HMAC key for webhook signatures, 16-256 characters. */
  secret?: string;
  digest: AlertDigest;
  immediate_critical: boolean;
}

export async function getAlertChannels(): Promise<AlertChannel[]> {
  const { data } = await apiClient.get<{ channels: AlertChannel[] }>("/api/v1/alert-channels");
  return data.channels;
}

export async function createAlertChannel(body: AlertChannelCreate): Promise<AlertChannel> {
  const { data } = await apiClient.post<AlertChannel>("/api/v1/alert-channels", body);
  return data;
}

export async function deleteAlertChannel(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/alert-channels/${id}`);
}

export async function testAlertChannel(id: string): Promise<{ delivered: boolean }> {
  const { data } = await apiClient.post<{ delivered: boolean }>(`/api/v1/alert-channels/${id}/test`);
  return data;
}
