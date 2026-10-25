"use client";

import { useQuery } from "@tanstack/react-query";
import { getTriageSettings } from "./api/triage";
import { browserTimezone } from "./format";
import { queryKeys } from "./query-keys";

/** Where the tenant time zone is set: Admin › Triage, Working calendar. */
export const TENANT_TIMEZONE_HREF = "/admin/triage#calendar";

/** The tenant's IANA time zone (Admin › Triage), the clock schedules run on; the browser's until it loads. */
export function useTenantTimezone(): string {
  return useQuery({ queryKey: queryKeys.triageSettings(), queryFn: getTriageSettings, staleTime: 300_000, select: (st) => st.timezone }).data
    ?? browserTimezone();
}
