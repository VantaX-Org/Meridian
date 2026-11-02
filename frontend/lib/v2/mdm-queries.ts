"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getAcrossSystems,
  getGlossary,
  getGlossaryTermDetail,
  getGoldenEvents,
  getGoldenExplain,
  getGoldenRecord,
  getGoldenRecords,
  getMatchPair,
  getMatchPairs,
  getObjectOwners,
  getProcessDocument,
  getSurvivorship,
  getMatchCalibration,
  getConsolidationPack,
} from "@/lib/api/v2/mdm";
import { getGoldenHistory, getWritebackPreview, getWritebackRequests } from "@/lib/api/v2/golden-writeback";

/** Query keys of the Golden records, Glossary and Processes tabs. The fixture flag is part of every key. */
export const mdmKeys = {
  root: ["v2", "mdm"] as const,
  golden: (f: boolean, module: string, page: number) => ["v2", "mdm", "golden", f, module, page] as const,
  goldenOne: (f: boolean, id: string) => ["v2", "mdm", "golden-one", f, id] as const,
  explain: (f: boolean, id: string) => ["v2", "mdm", "golden-explain", f, id] as const,
  events: (f: boolean, id: string) => ["v2", "mdm", "golden-events", f, id] as const,
  pairs: (f: boolean, module: string) => ["v2", "mdm", "pairs", f, module] as const,
  pair: (f: boolean, id: string) => ["v2", "mdm", "pair", f, id] as const,
  survivorship: (f: boolean, module: string) => ["v2", "mdm", "survivorship", f, module] as const,
  glossary: (f: boolean, module: string, search: string) => ["v2", "mdm", "glossary", f, module, search] as const,
  term: (f: boolean, id: string) => ["v2", "mdm", "term", f, id] as const,
  owners: (f: boolean) => ["v2", "mdm", "owners", f] as const,
  history: (f: boolean, id: string) => ["v2", "mdm", "golden-history", f, id] as const,
  wbPreview: (f: boolean, id: string) => ["v2", "mdm", "wb-preview", f, id] as const,
  wbRequests: (f: boolean, id: string) => ["v2", "mdm", "wb-requests", f, id] as const,
  process: (f: boolean, run: string, module: string) => ["v2", "mdm", "process", f, run, module] as const,
  calibration: (f: boolean, module: string) => ["v2", "mdm", "calibration", f, module] as const,
  pack: (f: boolean, module: string) => ["v2", "mdm", "consolidation-pack", f, module] as const,
};

const STALE = 30_000;

export function useGoldenRecords(module: string, page: number) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.golden(f, module, page), queryFn: () => getGoldenRecords(module, page), staleTime: STALE, retry: false });
}

/** The object's duplicate clusters that span two or more connected systems. */
export function useAcrossSystems(module: string) {
  const f = useFixture();
  return useQuery({ queryKey: ["v2", "mdm", "across-systems", f, module] as const, queryFn: () => getAcrossSystems(module), staleTime: STALE, retry: false });
}

export function useGoldenRecord(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.goldenOne(f, id), queryFn: () => getGoldenRecord(id), staleTime: STALE, retry: false });
}

export function useGoldenExplain(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.explain(f, id), queryFn: () => getGoldenExplain(id), staleTime: STALE, retry: false });
}

export function useGoldenEvents(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.events(f, id), queryFn: () => getGoldenEvents(id), staleTime: STALE, retry: false });
}

/** The first pairs waiting for a steward in the object, with the number still waiting. */
export function useMatchPairs(module: string, limit = 5) {
  const f = useFixture();
  return useQuery({ queryKey: [...mdmKeys.pairs(f, module), limit], queryFn: () => getMatchPairs(module, limit), staleTime: STALE, retry: false });
}

export function useMatchPair(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.pair(f, id), queryFn: () => getMatchPair(id), staleTime: STALE, retry: false });
}

export function useSurvivorship(module: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.survivorship(f, module), queryFn: () => getSurvivorship(module), staleTime: 5 * 60_000, retry: false });
}

export function useMatchCalibration(module: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.calibration(f, module), queryFn: () => getMatchCalibration(module), staleTime: STALE, retry: false });
}

export function useConsolidationPack(module: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.pack(f, module), queryFn: () => getConsolidationPack(module), staleTime: STALE, retry: false });
}

export function useGlossary(module: string, search: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.glossary(f, module, search), queryFn: () => getGlossary(module, search), staleTime: STALE, retry: false });
}

export function useTerm(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.term(f, id), queryFn: () => getGlossaryTermDetail(id), staleTime: STALE, retry: false });
}

export function useObjectOwners() {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.owners(f), queryFn: getObjectOwners, staleTime: 5 * 60_000, retry: false });
}

export function useProcessDocument(run: string | null | undefined, module: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.process(f, run ?? "", module), queryFn: () => getProcessDocument(run as string, module), staleTime: STALE, retry: false, enabled: enabled && Boolean(run) });
}

/** The field-level audit trail of a golden record. */
export function useGoldenHistory(id: string) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.history(f, id), queryFn: () => getGoldenHistory(id), staleTime: STALE, retry: false });
}

/** What a write-back of the record would send and where. Never contacts SAP. */
export function useWritebackPreview(id: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.wbPreview(f, id), queryFn: () => getWritebackPreview(id), staleTime: STALE, retry: false, enabled });
}

/** The record's write-back requests; polls while the simulation or the write is running. */
export function useWritebackRequests(id: string) {
  const f = useFixture();
  return useQuery({
    queryKey: mdmKeys.wbRequests(f, id),
    queryFn: () => getWritebackRequests(id),
    staleTime: 0,
    retry: false,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "simulating" || r.status === "applying") ? 3_000 : false),
  });
}
