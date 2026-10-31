import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

/** Master data change requests (api/routes/change_requests.py) and the workflow engine (api/routes/workflows.py). */

export type RequestKind = "create" | "change";
export type RequestObject = "material" | "customer" | "vendor" | "business_partner";
export type RequestStatus = "draft" | "submitted" | "in_approval" | "approved" | "rejected" | "creating" | "created" | "failed" | "cancelled";
export type RequestView = "mine" | "to_approve" | "all";

export interface ChangeRequest {
  id: string;
  kind: RequestKind;
  object: RequestObject;
  target_system_id: string | null;
  object_key: string | null;
  title: string | null;
  payload: Record<string, string>;
  status: RequestStatus;
  requester_id: string | null;
  requester_label: string | null;
  workflow_instance_id: string | null;
  precheck: Precheck | null;
  validated_at: string | null;
  sap_key: string | null;
  sap_result: { messages?: { type?: string; message?: string }[] } | null;
  sap_phase: string | null;
  sap_attempts: number;
  delivery: string | null;
  has_export: boolean;
  reason: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  decided_at: string | null;
  completed_at: string | null;
}

export interface PrecheckFailure { check_id: string; severity: string; dimension: string | null; field: string | null; message: string }
export interface PrecheckDuplicate { master_record_id: string; domain: string; sap_object_key: string | null; score: number; band: string; attributes: { field: string; similarity: number; value: string | null }[] }
export interface Precheck { problems: string[]; rules_run: number; failures: PrecheckFailure[]; duplicates: PrecheckDuplicate[]; checked_at: string | null }

export interface WorkflowTask {
  id: string;
  instance_id: string;
  step_index: number;
  step_name: string;
  status: string;
  quorum: string;
  assigned_users: string[];
  assignee_note: string | null;
  due_at: string | null;
  escalation_level: number;
  activated_at: string | null;
  skip_reason?: string | null;
  decided_by_label?: string | null;
  decision?: string | null;
  comment?: string | null;
  decided_at?: string | null;
}
export interface WorkflowInstance { id: string; definition_key: string; definition_version: number; status: string; started_at: string; completed_at: string | null; tasks: WorkflowTask[] }
export interface WorkflowEvent { id: string; action: string; from_status: string | null; to_status: string | null; actor_label: string | null; detail: Record<string, unknown> | null; created_at: string }
export interface RequestComment { id: string; author_label: string | null; body: string; created_at: string }
export interface RequestAttachment { id: string; filename: string; content_type: string | null; size_bytes: number | null; uploaded_by_label: string | null; created_at: string }
export interface RequestDetail { request: ChangeRequest; workflow: WorkflowInstance | null; history: WorkflowEvent[]; comments: RequestComment[]; attachments: RequestAttachment[] }

export interface RequestFilter { view: RequestView; status?: string; object?: string; kind?: string }
export interface RequestDraft { kind: RequestKind; object: RequestObject; target_system_id?: string | null; object_key?: string | null; title?: string | null; payload: Record<string, string> }

const enc = encodeURIComponent;
const cr = (id: string) => `/change-requests/${enc(id)}`;

export const listRequests = (f: RequestFilter) => v2Get<{ items: ChangeRequest[] }>("/change-requests", { ...f });
export const getRequest = (id: string) => v2Get<RequestDetail>(cr(id));
export const createRequest = (body: RequestDraft) => v2Send<ChangeRequest>("POST", "/change-requests", body);
export const validateRequest = (id: string) => v2Send<Precheck>("POST", `${cr(id)}/validate`);
export const submitRequest = (id: string) => v2Send<RequestDetail>("POST", `${cr(id)}/submit`);
export const decideRequest = (id: string, decision: "approve" | "reject", comment?: string, task_id?: string) => v2Send<RequestDetail>("POST", `${cr(id)}/decide`, { decision, comment, task_id });
export const cancelRequest = (id: string, reason?: string) => v2Send<ChangeRequest>("POST", `${cr(id)}/cancel`, { reason });
export const retryRequest = (id: string, checked_in_sap: boolean) => v2Send<ChangeRequest>("POST", `${cr(id)}/retry`, { checked_in_sap });
export const commentRequest = (id: string, body: string) => v2Send<RequestComment>("POST", `${cr(id)}/comments`, { body });
export const attachToRequest = (id: string, filename: string, content_type: string | null, size_bytes: number) => v2Send<RequestAttachment>("POST", `${cr(id)}/attachments`, { filename, content_type, size_bytes });
export const exportRequest = (id: string) => v2Download(`${cr(id)}/export`, undefined, `change_request_${id}.json`);

export interface WorkflowDefinition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  object_kind: string;
  version: number;
  active: boolean;
  definition: Record<string, unknown>;
  created_by_label: string | null;
  created_at: string;
  activated_at: string | null;
  activated_by_label: string | null;
}
export interface StepPreview { index: number; name: string; applies: boolean; reason: string | null; quorum: string; sla_hours: number | null; requester_may_approve: boolean; assignee_note: string | null; assignees: { id: string; name: string }[] }
export interface DryRun { valid: boolean; problems: string[]; facts: Record<string, unknown>; steps: StepPreview[] }
export interface Facts { facts: Record<string, unknown>; ops: string[]; assignee_rules: string[]; object_kinds: string[] }
export interface TaskRow extends WorkflowTask { object_kind: string; object_id: string; title: string | null; requester_label: string | null; may_decide: boolean; on_behalf_of: string | null }

export const listDefinitions = () => v2Get<{ items: WorkflowDefinition[] }>("/workflows/definitions");
export const getFacts = () => v2Get<Facts>("/workflows/facts");
export const newVersion = (id: string, definition: Record<string, unknown>, activate: boolean) => v2Send<WorkflowDefinition>("POST", `/workflows/definitions/${enc(id)}/versions`, { definition, activate });
export const activateDefinition = (id: string) => v2Send<WorkflowDefinition>("POST", `/workflows/definitions/${enc(id)}/activate`);
export const dryRun = (definition: Record<string, unknown>, object_kind: string, facts: Record<string, unknown>) => v2Send<DryRun>("POST", "/workflows/definitions/validate", { definition, object_kind, facts, payload: {} });
export const listTasks = (object_kind: string) => v2Get<{ items: TaskRow[] }>("/workflows/tasks", { scope: "mine", object_kind });
export const decideTask = (id: string, decision: "approve" | "reject", comment?: string) => v2Send<Record<string, unknown>>("POST", `/workflows/tasks/${enc(id)}/decide`, { decision, comment });
