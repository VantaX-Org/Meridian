/**
 * Admin Doctor API client — WS8 §10.4.
 *
 * Pairs with /api/v1/admin/doctor. The frontend polls every 30s via
 * react-query refetchInterval.
 */

import apiClient from "./client";

export interface DoctorItem {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail?: string | null;
}

export interface DoctorResponse {
  items: DoctorItem[];
  last_checked: string;
}

export async function getDoctor(): Promise<DoctorResponse> {
  const { data } = await apiClient.get<DoctorResponse>("/api/v1/admin/doctor");
  return data;
}
