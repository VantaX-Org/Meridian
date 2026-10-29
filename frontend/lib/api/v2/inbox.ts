import type { Notification } from "@/types/api";
import { v2Get, v2Send } from "./client";

export type { Notification };

export const getNotifications = (limit = 50): Promise<{ items: Notification[]; total: number }> => v2Get("/notifications", { limit });
export const getUnread = (): Promise<{ count: number }> => v2Get("/notifications/unread-count");
export const putRead = (id: string): Promise<{ id: string; is_read: boolean }> => v2Send("PUT", `/notifications/${encodeURIComponent(id)}/read`);
export const putReadAll = (): Promise<{ status: string }> => v2Send("PUT", "/notifications/read-all");
