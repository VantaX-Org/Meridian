"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import * as s9 from "@/lib/api/v2/step9";

/** Query keys of the step 9 reads. The fixture flag is in every key, so fixture and live answers never mix. */
export const s9Keys = {
  all: ["v2", "s9"] as const,
  top: (f: boolean, module: string, system: string | null, run: string | null) => ["v2", "s9", "top", f, module, system, run] as const,
  certs: (f: boolean, wave: string) => ["v2", "s9", "certs", f, wave] as const,
  money: (f: boolean, scope: string, id: string | null) => ["v2", "s9", "money", f, scope, id] as const,
  webhooks: (f: boolean) => ["v2", "s9", "webhooks", f] as const,
  events: (f: boolean) => ["v2", "s9", "webhook-events", f] as const,
  deliveries: (f: boolean, id: string, status: string | null) => ["v2", "s9", "deliveries", f, id, status] as const,
  automation: (f: boolean) => ["v2", "s9", "automation", f] as const,
  drift: (f: boolean, limit: number) => ["v2", "s9", "drift", f, limit] as const,
  objectContracts: (f: boolean, module: string, run: string | null) => ["v2", "s9", "object-contracts", f, module, run] as const,
  changes: (f: boolean, version: string) => ["v2", "s9", "changes", f, version] as const,
};

export function useTopFixes(module: string, systemId: string | null, run: string | null, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.top(f, module, systemId, run), queryFn: () => s9.getTopFixes(module, systemId, run), staleTime: 30_000, retry: false, enabled });
}

export function useCertificates(waveId: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.certs(f, waveId), queryFn: () => s9.getCertificates(waveId), staleTime: 15_000, retry: false, enabled: enabled && Boolean(waveId) });
}

export function useMoney(scope: s9.Money["scope"], id: string | null, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.money(f, scope, id), queryFn: () => s9.getMoney(scope, id), staleTime: 60_000, retry: false, enabled });
}

export function useWebhooks(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.webhooks(f), queryFn: s9.listWebhooks, staleTime: 15_000, enabled });
}

export function useWebhookEvents(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.events(f), queryFn: s9.listWebhookEvents, staleTime: 300_000, enabled });
}

export function useDeliveries(id: string, status: s9.WebhookDelivery["status"] | null, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.deliveries(f, id, status), queryFn: () => s9.listDeliveries(id, status ?? undefined), staleTime: 10_000, enabled: enabled && Boolean(id) });
}

export function useAutomation(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.automation(f), queryFn: s9.getAutomation, staleTime: 60_000, enabled });
}

export function useDriftAlerts(limit = 50, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.drift(f, limit), queryFn: () => s9.getDriftAlerts(limit), staleTime: 60_000, retry: false, enabled });
}

export function useObjectContracts(module: string, run: string | null, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.objectContracts(f, module, run), queryFn: () => s9.getObjectContracts(module, run), staleTime: 30_000, retry: false, enabled });
}

export function useVersionChanges(versionId: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: s9Keys.changes(f, versionId), queryFn: () => s9.getVersionChanges(versionId), staleTime: 300_000, retry: false, enabled: enabled && Boolean(versionId) });
}

/** After a step 9 write: its own reads, and the landscape, receipts and runs that show contract marks and baselines. */
export function refreshStep9(qc: QueryClient, part?: "webhooks" | "certs" | "contracts" | "automation"): Promise<void> {
  if (part === "webhooks") return qc.invalidateQueries({ queryKey: ["v2", "s9"], predicate: (q) => ["webhooks", "deliveries"].includes(String(q.queryKey[2])) });
  if (part === "certs") return qc.invalidateQueries({ queryKey: ["v2", "s9", "certs"] });
  if (part === "automation") return qc.invalidateQueries({ queryKey: ["v2", "s9", "automation"] });
  return qc.invalidateQueries({ queryKey: ["v2"] });
}
