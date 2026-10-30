"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getConfigCompare,
  getConfigDriftLog,
  getConfigItems,
  getSproConfig,
  getZAnomalies,
  getZDormant,
  getZDrift,
  getZGhost,
  getZMapping,
  getZProfile,
  getZRegistry,
  getZReport,
  getZRules,
} from "@/lib/api/v2/sys";
import { getAllDrafts, getModuleRules, getRuleList, getSuppressions } from "@/lib/api/v2/rulelib";
import { getModel, getReferenceModel, listModels, listVersions } from "@/lib/api/v2/designer";
import { getSurvivorship } from "@/lib/api/v2/mdm";
import { useLandscape } from "@/lib/v2/queries";
import { moduleSlug, systemSlug } from "@/lib/v2/score";

/** Query keys of the step 6b reads. Every key starts with "v2" and carries the fixture flag, like the other v2 keys. */
export const sysKeys = {
  spro: (f: boolean, system: string, module: string) => ["v2", "spro", f, system, module] as const,
  items: (f: boolean, system: string, object: string) => ["v2", "config-items", f, system, object] as const,
  drift: (f: boolean) => ["v2", "config-drift", f] as const,
  compare: (f: boolean, system: string, object: string | null) => ["v2", "config-compare", f, system, object] as const,
  z: (f: boolean, what: string, id?: string) => ["v2", "z", f, what, id ?? null] as const,
  rules: (f: boolean) => ["v2", "rule-list", f] as const,
  coverage: (f: boolean, module: string) => ["v2", "rule-coverage", f, module] as const,
  suppressions: (f: boolean) => ["v2", "rule-suppressions", f] as const,
  drafts: (f: boolean) => ["v2", "rule-drafts-all", f] as const,
  models: (f: boolean) => ["v2", "process-models", f] as const,
  model: (f: boolean, id: string, version: number | null) => ["v2", "process-model", f, id, version] as const,
  versions: (f: boolean, id: string) => ["v2", "process-versions", f, id] as const,
  reference: (f: boolean) => ["v2", "process-reference", f] as const,
  surv: (f: boolean, domain: string) => ["v2", "survivorship", f, domain] as const,
};

/** Refreshes everything the step 6b views read after a write. */
export function useRefreshV2(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["v2"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
  }, [qc]);
}

export function useSproConfig(system: string, module: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.spro(f, system, module), queryFn: () => getSproConfig(module, system), enabled: enabled && Boolean(module), retry: false, staleTime: 30_000 });
}
export function useConfigItems(system: string, object: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.items(f, system, object), queryFn: () => getConfigItems(system, object), enabled: enabled && Boolean(object), retry: false, staleTime: 30_000 });
}
export function useConfigDrift() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.drift(f), queryFn: getConfigDriftLog, retry: false, staleTime: 30_000 });
}
export function useConfigCompare(system: string, object: string | null) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.compare(f, system, object), queryFn: () => getConfigCompare(system, object ?? undefined), retry: false });
}

export function useZRegistry() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "registry"), queryFn: getZRegistry, retry: false });
}
export function useZProfile(id: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "profile", id), queryFn: () => getZProfile(id), enabled, retry: false });
}
export function useZAnomalies() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "anomalies"), queryFn: getZAnomalies, retry: false });
}
export function useZGhost() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "ghost"), queryFn: getZGhost, retry: false });
}
export function useZDormant() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "dormant"), queryFn: getZDormant, retry: false });
}
export function useZDrift() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "drift"), queryFn: getZDrift, retry: false });
}
export function useZRules() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "rules"), queryFn: getZRules, retry: false });
}
export function useZMapping() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "mapping"), queryFn: getZMapping, retry: false });
}
export function useZReport(enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.z(f, "report"), queryFn: getZReport, enabled, retry: false });
}

export function useRuleList() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.rules(f), queryFn: getRuleList, staleTime: 30_000 });
}
export function useModuleRules(module: string, enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.coverage(f, module), queryFn: () => getModuleRules(module), enabled, retry: false, staleTime: 60_000 });
}
export function useSuppressions() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.suppressions(f), queryFn: getSuppressions, retry: false });
}
export function useAllDrafts(enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.drafts(f), queryFn: getAllDrafts, enabled, retry: false });
}

export function useModels() {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.models(f), queryFn: listModels, retry: false });
}
export function useModel(id: string | null) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.model(f, id ?? "", null), queryFn: () => getModel(id as string), enabled: Boolean(id), retry: false });
}
export function useModelVersions(id: string | null) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.versions(f, id ?? ""), queryFn: () => listVersions(id as string), enabled: Boolean(id), retry: false });
}
export function useReferenceModel(enabled: boolean) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.reference(f), queryFn: getReferenceModel, enabled, retry: false });
}

export function useSurvivorshipRules(domain: string) {
  const f = useFixture();
  return useQuery({ queryKey: sysKeys.surv(f, domain), queryFn: () => getSurvivorship(domain), enabled: Boolean(domain), retry: false });
}

/** The process designer of an object: its address under the system that holds the object's latest run. */
export function useDesignerHref(module: string): string {
  const L = useLandscape(null).data;
  const cell = L?.cells.find((c) => c.module === module);
  const sys = L?.systems.find((x) => x.id === cell?.system_id) ?? L?.systems[0];
  return `/o/${systemSlug(sys?.name ?? "")}/${moduleSlug(module)}/processes/design`;
}
