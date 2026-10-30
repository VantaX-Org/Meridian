"use client";

import type { Job } from "@/types/jobs";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  getCompareSummary,
  getJobById,
  getJobsList,
  getSystemConfigLoad,
  getSystemExtractions,
  getSystemObjectList,
  getSystemProfiles,
  getSystemsExtended,
  getTimeline,
  getVersionCompare,
  getVersionHead,
  getVersionsPage,
  type VersionsQuery,
} from "@/lib/api/v2/runs";
import { JOBS_QUERY_OPTIONS } from "@/hooks/use-jobs";

/** Query keys of the step 3 reads. Every key starts with "v2" and carries the fixture flag, like the landscape keys. */
export const runKeys = {
  timeline: (fixture: boolean, systemId: string | null, limit: number) => ["v2", "timeline", fixture, systemId, limit] as const,
  compare: (fixture: boolean, a: string, b: string) => ["v2", "compare", fixture, a, b] as const,
  changes: (fixture: boolean, a: string, b: string) => ["v2", "compare-changes", fixture, a, b] as const,
  head: (fixture: boolean, id: string) => ["v2", "run-head", fixture, id] as const,
  versions: (fixture: boolean, q: VersionsQuery) => ["v2", "versions", fixture, q.limit ?? 50, q.system_id ?? null, q.include_archived ?? false, q.status ?? null] as const,
  fixtureJobs: ["v2", "jobs", "fixture"] as const,
  job: (fixture: boolean, id: string) => ["v2", "job", fixture, id] as const,
  systems: (fixture: boolean) => ["v2", "systems", fixture] as const,
  extractions: (fixture: boolean, id: string) => ["v2", "system-extractions", fixture, id] as const,
  profiles: (fixture: boolean, id: string) => ["v2", "system-profiles", fixture, id] as const,
  configLoad: (fixture: boolean, id: string) => ["v2", "system-config", fixture, id] as const,
  objects: (fixture: boolean, id: string) => ["v2", "system-objects", fixture, id] as const,
};

/** The last `limit` runs of the scope (one system, or all), oldest first. */
export function useTimeline(systemId: string | null, limit = 8) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.timeline(fixture, systemId, limit), queryFn: () => getTimeline(systemId, limit), staleTime: 30_000 });
}

export function useCompareSummary(a: string, b: string) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.compare(fixture, a, b), queryFn: () => getCompareSummary(a, b), staleTime: 30_000, retry: false });
}

export function useVersionChanges(a: string, b: string) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.changes(fixture, a, b), queryFn: () => getVersionCompare(a, b), staleTime: 30_000, retry: false });
}

export function useVersionHead(id: string) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.head(fixture, id), queryFn: () => getVersionHead(id), staleTime: 15_000, retry: false });
}

export function useVersionsPage(q: VersionsQuery) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.versions(fixture, q), queryFn: () => getVersionsPage(q), staleTime: 15_000 });
}

/** Jobs: the cache the jobs stream patches (live), or the fixture list. The stream itself is mounted once, by the shell. */
export function useV2Jobs() {
  const fixture = useFixture();
  // Live: the page's one shared jobs read (hooks/use-jobs.ts JOBS_QUERY_OPTIONS); fixture mode reads the fixture list.
  const q = useQuery<Job[]>({
    queryKey: fixture ? runKeys.fixtureJobs : JOBS_QUERY_OPTIONS.queryKey,
    queryFn: fixture ? () => getJobsList(100) : JOBS_QUERY_OPTIONS.queryFn,
    staleTime: fixture ? 5_000 : JOBS_QUERY_OPTIONS.staleTime,
    refetchOnMount: fixture ? true : JOBS_QUERY_OPTIONS.refetchOnMount,
    refetchInterval: fixture ? false : JOBS_QUERY_OPTIONS.refetchInterval,
  });
  const jobs = q.data ?? [];
  return { ...q, jobs, active: jobs.filter((j) => j.status === "queued" || j.status === "running") };
}

/** One job by id: from the list when it is there, else asked for. */
export function useV2Job(id: string) {
  const fixture = useFixture();
  const list = useV2Jobs();
  const inList = list.jobs.find((j) => j.id === id);
  const one = useQuery({ queryKey: runKeys.job(fixture, id), queryFn: () => getJobById(id), enabled: !inList && !list.isLoading, retry: false });
  return { job: inList ?? one.data ?? null, loading: list.isLoading || (!inList && one.isLoading), missing: !inList && !list.isLoading && one.isError, refetch: list.refetch };
}

export function useSystemsExtended() {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.systems(fixture), queryFn: getSystemsExtended, staleTime: 30_000 });
}

export function useSystemExtractions(id: string, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.extractions(fixture, id), queryFn: () => getSystemExtractions(id), staleTime: 15_000, enabled });
}

export function useSystemProfiles(id: string, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.profiles(fixture, id), queryFn: () => getSystemProfiles(id), staleTime: 30_000, enabled });
}

export function useSystemConfigLoad(id: string, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.configLoad(fixture, id), queryFn: () => getSystemConfigLoad(id), staleTime: 15_000, enabled });
}

export function useSystemObjectList(id: string, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: runKeys.objects(fixture, id), queryFn: () => getSystemObjectList(id), staleTime: 30_000, enabled });
}
