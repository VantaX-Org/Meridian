"use client";

import { useQuery } from "@tanstack/react-query";
import * as api from "@/lib/api/v2/enterprise";
import { useFixture } from "@/lib/api/v2/fixture";

/** Every enterprise read hangs under ["v2", "admin", fixture, ...] so refreshAdmin(qc, "<part>") refreshes it after a write. */
const k = (fixture: boolean, ...rest: unknown[]) => ["v2", "admin", fixture, ...rest] as const;

/** The status page, read again every 60 seconds while it is on screen. */
export const STATUS_REFRESH_MS = 60_000;

export const useStatusPage = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: k(f, "status", "page"), queryFn: api.getStatusPage, enabled, retry: false, staleTime: 30_000, refetchInterval: STATUS_REFRESH_MS });
};
export const useThemeSettings = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: k(f, "theme", "settings"), queryFn: api.getThemeSettings, enabled, retry: false, staleTime: 15_000 });
};
export const useCompliance = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: k(f, "compliance"), queryFn: api.getCompliance, enabled, retry: false, staleTime: 15_000 });
};
export const useDiagnostics = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: k(f, "diagnostics"), queryFn: api.getDiagnostics, enabled, retry: false, staleTime: 60_000 });
};
export const useScimToken = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: k(f, "scim", "token"), queryFn: api.getScimToken, enabled, retry: false, staleTime: 15_000 });
};
export const useScimGroupRoles = (enabled = true) => {
  const f = useFixture();
  return useQuery({ queryKey: k(f, "scim", "groups"), queryFn: api.getScimGroupRoles, enabled, retry: false, staleTime: 15_000 });
};
