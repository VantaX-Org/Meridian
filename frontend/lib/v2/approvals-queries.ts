"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBatch, getBatchEvents, getBatches, getWritebackMode } from "@/lib/api/v2/batches";
import { getNotifications, getUnread, putRead, putReadAll } from "@/lib/api/v2/inbox";
import { getNextSteps, getPeople } from "@/lib/api/v2/people";
import { getAssignable, getPreferences, getSlaPolicies, patchDigest, putSlaPolicy, type Digest, type SlaPolicy } from "@/lib/api/v2/triage";
import { getWork } from "@/lib/api/v2/work";
import { toBatchRow, withRecords, type BatchRow } from "./batches";

/** Every key starts with "v2", so the one invalidation after a change (refreshV2) reaches all of them. */
export const approvalKeys = {
  batches: (fx: boolean) => ["v2", "batches", fx] as const,
  batch: (fx: boolean, id: string) => ["v2", "batch", fx, id] as const,
  events: (fx: boolean, id: string) => ["v2", "batch-events", fx, id] as const,
  mode: (fx: boolean) => ["v2", "writeback-mode", fx] as const,
  people: (fx: boolean) => ["v2", "people", fx] as const,
  next: (fx: boolean) => ["v2", "people-next", fx] as const,
  personWork: (fx: boolean, id: string) => ["v2", "person-work", fx, id] as const,
  notifications: (fx: boolean) => ["v2", "notifications", fx] as const,
  unread: (fx: boolean) => ["v2", "notifications-unread", fx] as const,
  sla: (fx: boolean) => ["v2", "triage-sla", fx] as const,
  digest: (fx: boolean) => ["v2", "triage-digest", fx] as const,
  assignable: (fx: boolean) => ["v2", "assignable", fx] as const,
};

const STALE = 15_000;

/** Every batch, as the interface words them. Batches with no record in them are left out. */
export function useBatches(enabled = true) {
  const fx = useFixture();
  const q = useQuery({ queryKey: approvalKeys.batches(fx), queryFn: getBatches, staleTime: STALE, enabled });
  const rows = useMemo<BatchRow[]>(() => withRecords((q.data?.items ?? []).map(toBatchRow)), [q.data]);
  return { ...q, rows };
}

export function useBatch(id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.batch(fx, id), queryFn: () => getBatch(id), staleTime: STALE, retry: false });
}

export function useBatchEvents(id: string) {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.events(fx, id), queryFn: () => getBatchEvents(id), staleTime: STALE, retry: false });
}

/** Whether this deployment writes approved batches back to SAP itself (needs the approve permission; false when unknown). */
export function useWritebackLive(enabled: boolean) {
  const fx = useFixture();
  const q = useQuery({ queryKey: approvalKeys.mode(fx), queryFn: getWritebackMode, staleTime: 60_000, retry: false, enabled });
  return q.data?.live_enabled ?? false;
}

export function usePeople() {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.people(fx), queryFn: getPeople, staleTime: STALE });
}

/** What waits for the caller (GET /people/next), in the order to do it. */
export function useNextSteps() {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.next(fx), queryFn: getNextSteps, staleTime: STALE });
}

/** A person's open work, the first page of it: grouped by object in their inspector. */
export function usePersonWork(id: string, mine: boolean, enabled = true) {
  const fx = useFixture();
  return useQuery({
    queryKey: approvalKeys.personWork(fx, id),
    queryFn: () => getWork({ assigned: mine ? "me" : id, status: "open", limit: 200, sort: "severity" }),
    staleTime: STALE,
    enabled,
  });
}

export function useNotifications(enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.notifications(fx), queryFn: () => getNotifications(50), staleTime: 10_000, enabled });
}

/** The Inbox count in the top bar: notifications not yet read. Marking one read invalidates it. */
export function useUnread() {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.unread(fx), queryFn: getUnread, staleTime: 10_000, refetchInterval: fx ? false : 60_000 });
}

/** Mark one notification read, or all of them, then refetch the list and the count. */
export function useMarkRead() {
  const qc = useQueryClient();
  const fx = useFixture();
  const done = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: approvalKeys.notifications(fx) }), qc.invalidateQueries({ queryKey: approvalKeys.unread(fx) })]);
  };
  const one = useMutation({ mutationFn: (id: string) => putRead(id), onSuccess: done });
  const all = useMutation({ mutationFn: () => putReadAll(), onSuccess: done });
  return { one, all };
}

export function useSlaPolicies() {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.sla(fx), queryFn: getSlaPolicies, staleTime: STALE, retry: false });
}

export function useDigest() {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.digest(fx), queryFn: getPreferences, staleTime: STALE, retry: false });
}

/** Save the settings: one PUT per severity that changed, then the digest. */
export function useSaveTriage() {
  const qc = useQueryClient();
  const fx = useFixture();
  return useMutation({
    mutationFn: async (v: { policies: SlaPolicy[]; digest: Digest | null }) => {
      for (const p of v.policies) await putSlaPolicy({ severity: p.severity, module: p.module, ack_minutes: p.ack_minutes, resolve_minutes: p.resolve_minutes, at_risk_pct: p.at_risk_pct, business_hours: p.business_hours });
      if (v.digest) await patchDigest(v.digest);
    },
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: approvalKeys.sla(fx) }), qc.invalidateQueries({ queryKey: approvalKeys.digest(fx) })]);
    },
  });
}

/** The people work can be assigned to; loaded when a menu opens. */
export function useAssignable(enabled: boolean) {
  const fx = useFixture();
  return useQuery({ queryKey: approvalKeys.assignable(fx), queryFn: getAssignable, staleTime: 60_000, enabled, retry: false });
}
