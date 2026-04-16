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
