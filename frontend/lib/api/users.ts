import apiClient from "./client";
import type { User, UserListResponse, UserRole } from "@/types/api";

export async function getUsers(): Promise<UserListResponse> {
  const { data } = await apiClient.get<UserListResponse>("/api/v1/users");
  return data;
}

export async function updateUser(
  userId: string,
  body: { role?: UserRole; is_active?: boolean }
): Promise<User> {
  const { data } = await apiClient.put<User>(`/api/v1/users/${userId}`, body);
  return data;
}

export async function inviteUser(body: {
  email: string;
  name?: string;
  role?: UserRole;
}): Promise<{ id: string; email: string; role: string; status: string }> {
  const { data } = await apiClient.post("/api/v1/users/invite", body);
  return data;
}
