"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getFacts, getRequest, listDefinitions, listRequests, listTasks, type RequestFilter } from "@/lib/api/v2/requests";

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
