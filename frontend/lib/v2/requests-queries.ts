"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getFacts, getFieldHistory, getMassPreview, getRequest, getWorkflowInstance, listCriticalFields, listDefaults, listDefinitions, listDerivations, listRequests, listTasks, type RequestFilter } from "@/lib/api/v2/requests";

const STALE = 15_000;

/** Change requests and workflow reads. Every key starts with "v2", so one invalidation after a change reaches them all. */
export function useRequests(f: RequestFilter) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "change-requests", fx, f], queryFn: () => listRequests(f), staleTime: STALE, retry: false });
}

export function useRequest(id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "change-request", fx, id], queryFn: () => getRequest(id), staleTime: STALE, retry: false });
}

/** One approval run with its steps and audit trail; read only once `enabled`. */
export function useWorkflowInstance(id: string, enabled: boolean) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "workflow-instance", fx, id], queryFn: () => getWorkflowInstance(id), staleTime: STALE, retry: false, enabled });
}

/** The workflow steps waiting for this person on objects of one kind (fix_batch, change_request). */
export function useMyTasks(objectKind: string) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "workflow-tasks", fx, objectKind], queryFn: () => listTasks(objectKind), staleTime: STALE, retry: false });
}

export function useDefinitions(enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "workflow-definitions", fx], queryFn: listDefinitions, staleTime: STALE, retry: false, enabled });
}

export function useFacts(enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "workflow-facts", fx], queryFn: getFacts, staleTime: 60_000, retry: false, enabled });
}

/** The per-field change history of one request. */
export function useFieldHistory(id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "change-request-fields", fx, id], queryFn: () => getFieldHistory(id), staleTime: STALE, retry: false });
}

/** The per-record before and after of a mass change draft. */
export function useMassPreview(id: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "change-request-preview", fx, id], queryFn: () => getMassPreview(id as string), staleTime: STALE, retry: false, enabled: id !== null });
}

/** The tenant's entry defaults for new create requests. */
export function useEntryDefaults() {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "request-defaults", fx], queryFn: listDefaults, staleTime: STALE, retry: false });
}

/** The tenant derivation rules (a field set from other fields of the request). */
export function useDerivations() {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "request-derivations", fx], queryFn: listDerivations, staleTime: STALE, retry: false });
}

/** The tenant critical fields (a change to one adds an approval step). */
export function useCriticalFields() {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "request-critical-fields", fx], queryFn: listCriticalFields, staleTime: STALE, retry: false });
}
