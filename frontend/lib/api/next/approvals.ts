/**
 * Write-back requests and the second-person decision (api/routes/writeback.py).
 *   GET  /writeback/requests?state=&limit=          every live request, newest first
 *   GET  /writeback/requests/{id}                   one request with each change as before and after
 *   POST /writeback/approve/{id}                    approve (a second person; 403 for the requester, 409 when decided)
 *   POST /writeback/reject/{id}  {reason}           reject (same guards)
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v2Get, v2Send } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";

export type RequestState = "pending" | "approved" | "rejected" | "dry_run";

export interface ChangeRow {
  record_key: string;
  field: string;
  before: string | null;
  after: string;
  delivery: "bapi" | "export";
  bapi: string | null;
  reason: string | null;
}

export interface RequestRow {
  id: string;
  state: RequestState;
  finding_id: string | null;
  version_id: string | null;
  module: string | null;
  check_id: string | null;
  rule_message: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  approved_by_name: string | null;
  rejected_by_name: string | null;
  records_updated: number;
  sap_host: string | null;
  created_at: string | null;
  applied_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
}

export interface RequestList {
  items: RequestRow[];
  live_enabled: boolean;
}

export interface RequestDetail extends RequestRow {
  changes: ChangeRow[];
  approvers: string[];
  is_requester: boolean;
  can_decide: boolean;
  cannot_decide_reason: "own_request" | "not_pending" | "no_permission" | null;
  errors: string[];
  live_enabled: boolean;
  undo_available: boolean;
  undo_note: string;
}

export const getRequests = (state?: RequestState): Promise<RequestList> => v2Get<RequestList>("/writeback/requests", { state, limit: 200 });
export const getRequest = (id: string): Promise<RequestDetail> => v2Get<RequestDetail>(`/writeback/requests/${encodeURIComponent(id)}`);
export const approveRequest = (id: string) => v2Send<{ applied: number; errors: string[]; status: string }>("POST", `/writeback/approve/${encodeURIComponent(id)}`);
export const rejectRequest = (id: string, reason: string) => v2Send<{ status: string }>("POST", `/writeback/reject/${encodeURIComponent(id)}`, { reason });

const key = (fx: boolean) => ["v2", "wb-requests", fx] as const;

export function useRequests(state?: RequestState) {
  const fx = useFixture();
  return useQuery({ queryKey: [...key(fx), "list", state ?? "all"], queryFn: () => getRequests(state), staleTime: 15_000 });
}

export function useRequest(id: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: [...key(fx), "one", id], queryFn: () => getRequest(id as string), enabled: !!id, staleTime: 15_000, retry: false });
}

/** Approve or reject; every request list and detail is read again after. */
export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reject?: string }) => (v.reject === undefined ? approveRequest(v.id) : rejectRequest(v.id, v.reject)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["v2", "wb-requests"] }),
  });
}
