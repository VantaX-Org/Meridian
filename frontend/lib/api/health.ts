import apiClient from "./client";
import type { HealthResponse } from "@/types/api";

/** GET /health (api/routes/health.py): version, model connectivity, licence and the email backend. */
export async function getHealth(): Promise<HealthResponse> {
  const { data } = await apiClient.get<HealthResponse>("/health");
  return data;
}
