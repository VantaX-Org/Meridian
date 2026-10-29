"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
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
} from "@/lib/api/v2/mdm";

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
  process: (f: boolean, run: string, module: string) => ["v2", "mdm", "process", f, run, module] as const,
};

const STALE = 30_000;

export function useGoldenRecords(module: string, page: number) {
  const f = useFixture();
  return useQuery({ queryKey: mdmKeys.golden(f, module, page), queryFn: () => getGoldenRecords(module, page), staleTime: STALE, retry: false });
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
