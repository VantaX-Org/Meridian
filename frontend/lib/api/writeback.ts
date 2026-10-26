import apiClient from "./client";

export interface PendingApproval {
  id: string;
  finding_id: string | null;
  version_id: string | null;
  requested_by: string | null;
  records_updated: number;
  sap_host: string | null;
  created_at: string | null;
  /** The finding's rule, module and rule message, joined by the API so an approver never reads a bare finding id. */
  check_id?: string | null;
  module?: string | null;
  rule_message?: string | null;
  /** The requester's name (else email), joined by the API: a data owner cannot read the users list. */
  requested_by_name?: string | null;
}

/** Live write-back requests awaiting a second approver (needs `approve`). */
export async function getPendingApprovals(): Promise<{ approvals: PendingApproval[]; live_enabled: boolean }> {
  return (await apiClient.get("/api/v1/writeback/approvals")).data;
}

export async function approveWriteback(id: string): Promise<{ applied: number; errors: string[]; status: string }> {
  return (await apiClient.post(`/api/v1/writeback/approve/${id}`)).data;
}
