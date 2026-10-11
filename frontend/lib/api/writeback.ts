import apiClient from "./client";

export interface PendingApproval {
  id: string;
  finding_id: string | null;
  version_id: string | null;
  requested_by: string | null;
  records_updated: number;
  sap_host: string | null;
  created_at: string | null;
}

/** Live write-back requests awaiting a second approver (needs `approve`). */
export async function getPendingApprovals(): Promise<{ approvals: PendingApproval[]; live_enabled: boolean }> {
  return (await apiClient.get("/api/v1/writeback/approvals")).data;
}

export async function approveWriteback(id: string): Promise<{ applied: number; errors: string[]; status: string }> {
  return (await apiClient.post(`/api/v1/writeback/approve/${id}`)).data;
}
