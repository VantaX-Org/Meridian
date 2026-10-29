"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import * as api from "@/lib/api/v2/admin";
import * as rep from "@/lib/api/v2/reports";
import type { AuditListParams } from "@/lib/api/audit";

/** Every admin, report and wave read hangs under ["v2", "admin", ...]; the fixture flag is in each key. */
const k = (fixture: boolean, ...rest: unknown[]) => ["v2", "admin", fixture, ...rest] as const;

const STALE = 15_000;

function useRead<T>(key: readonly unknown[], fn: () => Promise<T>, enabled = true, extra: { refetchInterval?: number; retry?: boolean } = {}) {
  return useQuery({ queryKey: key, queryFn: fn, staleTime: STALE, enabled, retry: extra.retry ?? false, refetchInterval: extra.refetchInterval });
}

/** After a write: the reads that could show it are marked stale and the ones on screen refetch. */
export function refreshAdmin(qc: QueryClient, ...parts: string[]): Promise<void> {
  return qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "v2" && q.queryKey[1] === "admin" && parts.every((p, i) => q.queryKey[3 + i] === p) });
}

export const useUsers = (q: api.UserQuery = {}, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "users", "list", q), () => api.listUsers(q), enabled);
};
export const useRoles = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "roles", "list"), api.listRoles, enabled);
};
export const useRolesMatrix = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "roles", "matrix"), api.getRolesMatrix, enabled);
};
export const useRolePermissions = (key: string, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "roles", "perm", key), () => api.getRolePermissions(key), enabled);
};
export const useGrants = (userId: string, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "users", "grants", userId), () => api.listGrants(userId), enabled);
};
export const useEffective = (userId: string, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "users", "effective", userId), () => api.getUserEffective(userId), enabled);
};
export const useGrantPreview = (userId: string, role: string, system: string, module: string) => {
  const f = useFixture();
  return useRead(k(f, "users", "preview", userId, role, system, module), () => api.previewGrant(userId, { role_key: role, system_id: system || null, module: module || null }), !!role);
};
export const useAccessRequests = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "users", "requests"), () => api.listAccessRequests("open"), enabled);
};
export const useSso = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "sso"), api.getSso, enabled);
};
export const useApiKeys = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "apikeys"), api.listApiKeys, enabled);
};
export const useLicence = () => {
  const f = useFixture();
  return useRead(k(f, "licence"), api.getLicence);
};
export const useBilling = (period: string, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "billing", period), () => api.getBilling(period), enabled && /^\d{4}-\d{2}$/.test(period));
};
export const useUpdateStatus = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "system", "update"), api.getUpdateStatus, enabled);
};
export const useDoctor = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "system", "doctor"), api.getDoctor, enabled, { refetchInterval: f ? undefined : 30_000 });
};
export const useHealth = () => {
  const f = useFixture();
  return useRead(k(f, "system", "health"), api.getHealth);
};
export const useTenantSettings = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "settings", "tenant"), api.getTenantSettings, enabled);
};
export const useScoring = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "settings", "scoring"), api.getScoring, enabled);
};
export const useCostModel = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "settings", "cost"), api.getCostModel, enabled);
};
export const useRetention = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "settings", "retention"), api.getRetention, enabled);
};
export const usePurgeLog = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "settings", "purge-log"), () => api.getPurgeLog(20), enabled);
};
export const useMappings = (q: { module?: string; search?: string } = {}, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "mappings", q), () => api.listFieldMappings(q), enabled);
};
export const useReference = (systemId: string) => {
  const f = useFixture();
  return useRead(k(f, "reference", systemId), () => api.getReferenceLists(systemId), !!systemId);
};
export const useAudit = (q: AuditListParams, enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "audit", q), () => api.listAudit(q), enabled);
};
export const useAuditEntry = (id: string, enabled = true) => {
  const f = useFixture();
  // The entry is one row of the same list: ask for the wide window and pick it, so a deep link works.
  return useRead(k(f, "audit", "entry", id), async () => (await api.listAudit({ limit: 200 })).entries.find((e) => e.id === id) ?? null, enabled);
};
export const useChannels = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "channels"), api.listChannels, enabled);
};
export const useAlertSettings = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "settings", "alerts"), api.getTenantSettings, enabled);
};
export const useMyPreferences = () => {
  const f = useFixture();
  return useRead(k(f, "me", "preferences"), api.getMyPreferences);
};

export const useReportHistory = (kind?: string) => {
  const f = useFixture();
  return useRead(k(f, "reports", "history", kind ?? ""), () => rep.getReportHistory({ kind, limit: 100 }));
};
export const useCatalogue = (q: { version_id?: string; module?: string; compare?: string }) => {
  const f = useFixture();
  return useRead(k(f, "reports", "catalogue", q), () => rep.getCatalogue(q));
};
export const useSchedules = () => {
  const f = useFixture();
  return useRead(k(f, "reports", "schedules"), rep.getSchedules);
};
export const useScheduleOptions = () => {
  const f = useFixture();
  return useRead(k(f, "reports", "options"), rep.getScheduleOptions);
};
export const useWaves = (enabled = true) => {
  const f = useFixture();
  return useRead(k(f, "waves"), rep.getWaves, enabled);
};
