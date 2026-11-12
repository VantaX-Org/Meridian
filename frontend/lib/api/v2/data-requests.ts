/**
 * Data collection client (api/routes/data_collection.py). A steward asks an owner for missing or wrong values; the owner
 * fills a form; the values go to the cleaning queue as proposals for approval.
 *
 *   GET  /data-requests/findings?module=      findings a request can cover (needs `assign`)
 *   POST /data-requests                       create a request (needs `assign`)
 *   GET  /data-requests?mine=                 requests with progress; all of them needs `assign`
 *   GET  /data-requests/{id}                  one request with its form rows
 *   POST /data-requests/{id}/submit           the owner's values
 */
import { v2Get, v2Send } from "./client";

export interface FindingOption { check_id: string; field: string; field_label?: string | null; failing: number; required_empty: boolean }
export interface FindingOptions { version_id?: string | null; module: string; findings: FindingOption[] }

export type RequestStatus = "open" | "submitted" | "approved";
export interface RequestSummary {
  id: string; version_id: string; module: string; owner_id: string; owner_name?: string | null; due_date: string; note: string; created_at: string;
  total: number; open: number; submitted: number; approved: number; rejected: number; status: RequestStatus;
}
export type ItemState = "open" | "submitted" | "approved" | "rejected";
export interface AllowedValue { value: string; label?: string | null }
export interface RequestItem {
  id: string; check_id: string; record_key: string; field: string; field_label?: string | null; current_value?: string | null;
  new_value?: string | null; state: ItemState; max_length?: number | null; allowed_values?: AllowedValue[] | null;
}
export interface RequestDetail extends RequestSummary { items: RequestItem[] }
export interface CreateRequestBody { module: string; check_ids: string[]; owner_id: string; due_date: string; note: string; version_id?: string; max_records?: number }
export interface ItemError { item_id: string; error: string }
export interface SubmitOut { submitted: number; errors: ItemError[] }

export const getRequestFindings = (module: string): Promise<FindingOptions> => v2Get("/data-requests/findings", { module });
export const createDataRequest = (body: CreateRequestBody): Promise<RequestSummary> => v2Send("POST", "/data-requests", body);
export const listDataRequests = (mine: boolean): Promise<RequestSummary[]> => v2Get("/data-requests", { mine });
export const getDataRequest = (id: string): Promise<RequestDetail> => v2Get(`/data-requests/${encodeURIComponent(id)}`);
export const submitDataRequest = (id: string, values: { item_id: string; value: string }[]): Promise<SubmitOut> =>
  v2Send("POST", `/data-requests/${encodeURIComponent(id)}/submit`, { values });
