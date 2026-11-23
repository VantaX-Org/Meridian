"use client";

/** The reads of the Load area that lib/api/next/load.ts does not cover. Each key holds the fixture flag so fixture and live data never mix. */
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import * as cmp from "@/lib/api/v2/compare";
import * as mig from "@/lib/api/v2/migration";
import { getS4Readiness } from "@/lib/api/v2/s4";
import { getCertificates } from "@/lib/api/v2/step9";
import { getLoadPlan } from "@/lib/api/v2/load-plan";
import { getWaves, getWaveCockpit } from "@/lib/api/v2/reports";

const K = (fx: boolean, ...r: unknown[]) => ["ui", "load", fx, ...r] as const;

export const useLoadPlan = () => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "plan"), queryFn: () => getLoadPlan() }); };
export const useS4 = () => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "s4"), queryFn: getS4Readiness }); };
export const useCerts = (waveId: string | null) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "certs", waveId), queryFn: () => getCertificates(waveId as string), enabled: !!waveId }); };
export const useRun = (id: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "run", id), queryFn: () => mig.getMigrationRun(id) }); };
export const useRecon = (id: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "recon", id), queryFn: () => mig.getReconciliation(id), retry: false }); };
export const useRecords = (id: string, status: "load_fail" | "load_ready") => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "records", id, status), queryFn: () => mig.getMigrationRecords(id, status) }); };
export const useFieldMap = (module: string, dest: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "fieldmap", module, dest), queryFn: () => mig.getFieldMap(module, dest) }); };
export const useValueMap = (module: string, field: string | null) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "valuemap", module, field), queryFn: () => mig.getValueMap(module, field as string), enabled: !!field }); };
export const useTemplateList = (module: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "templates", module), queryFn: () => mig.getTemplates(module) }); };
export const usePairs = () => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "pairs"), queryFn: cmp.getPairs }); };
export const usePairLatest = (id: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "pair", id), queryFn: () => cmp.getLatest(id), enabled: !!id }); };
export const usePairTrend = (id: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "pair-trend", id), queryFn: () => cmp.getTrend(id) }); };
export const useDiffs = (cid: string | null, q: cmp.DiffQuery) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "diffs", cid, q), queryFn: () => cmp.getDifferences(cid as string, q), enabled: !!cid }); };

export const invalidateLoad = (qc: import("@tanstack/react-query").QueryClient) => qc.invalidateQueries({ queryKey: ["ui", "load"] });

export const useWaves = () => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "waves"), queryFn: getWaves }); };
export const useCockpit = (id: string) => { const fx = useFixture(); return useQuery({ queryKey: K(fx, "cockpit", id), queryFn: () => getWaveCockpit(id) }); };
