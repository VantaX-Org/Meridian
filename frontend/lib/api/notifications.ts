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

/* ─── The signed-in user's own delivery (api/routes/me_notifications.py) ─── */

/** sent_unrecorded: the email went out but the delivery log could not be updated. */
export type TestEmailStatus = "sent" | "no_backend" | "failed" | "sent_unrecorded";

export interface TestNotificationResult {
  email: TestEmailStatus;
  /** Always true: an in-app notification addressed to the caller is written either way. */
  in_app: boolean;
}

export type DeliveryChannel = "email" | "in_app";
export type DeliveryKind = "critical" | "digest" | "test";
export type DeliveryStatus = "sent" | "failed" | "no_backend" | "skipped";

export interface NotificationDelivery {
  id: string;
  channel: DeliveryChannel;
  kind: DeliveryKind;
  status: DeliveryStatus;
  error: string | null;
  created_at: string;
}

/** POST /api/v1/me/notifications/test: a test to the caller; 3 per hour per user (429 beyond). */
export async function sendTestNotification(): Promise<TestNotificationResult> {
  const { data } = await apiClient.post<TestNotificationResult>("/api/v1/me/notifications/test");
  return data;
}

/** GET /api/v1/me/notifications/deliveries: the caller's own delivery log, newest first. */
export async function getMyDeliveries(limit = 20): Promise<NotificationDelivery[]> {
  const { data } = await apiClient.get<{ items: NotificationDelivery[] }>("/api/v1/me/notifications/deliveries", {
    params: { limit },
  });
  return data.items;
}

/* ─── Alert channels (outbound webhook / Slack / Teams / email) ─── */

export type AlertChannelKind = "webhook" | "slack" | "teams" | "email";
export type AlertDigest = "daily" | "weekly" | "off";
/** How often an email channel receives the board pack and the analyst workbook. */
export type AlertReportPack = "off" | "weekly" | "monthly";

/** A channel as listed: webhook targets are redacted to the host; the secret is never returned. */
export interface AlertChannel {
  id: string;
  kind: AlertChannelKind;
  target: string;
  digest: AlertDigest;
  /** Board pack by email; only email channels can be set to anything but "off". Absent means off. */
  report_pack?: AlertReportPack;
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
  report_pack?: AlertReportPack;
}

/** Any subset of a channel's settings; what is left out stays as it is. */
export interface AlertChannelUpdate {
  digest?: AlertDigest;
  immediate_critical?: boolean;
  enabled?: boolean;
  report_pack?: AlertReportPack;
}

export async function getAlertChannels(): Promise<AlertChannel[]> {
  const { data } = await apiClient.get<{ channels: AlertChannel[] }>("/api/v1/alert-channels");
  return data.channels;
}

export async function createAlertChannel(body: AlertChannelCreate): Promise<AlertChannel> {
  const { data } = await apiClient.post<AlertChannel>("/api/v1/alert-channels", body);
  return data;
}

export async function updateAlertChannel(id: string, body: AlertChannelUpdate): Promise<AlertChannel> {
  const { data } = await apiClient.put<AlertChannel>(`/api/v1/alert-channels/${id}`, body);
  return data;
}

export async function deleteAlertChannel(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/alert-channels/${id}`);
}

export async function testAlertChannel(id: string): Promise<{ delivered: boolean }> {
  const { data } = await apiClient.post<{ delivered: boolean }>(`/api/v1/alert-channels/${id}/test`);
  return data;
}
