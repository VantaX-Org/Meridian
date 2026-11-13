"use client";

/**
 * Reads of the object page: one object's runs paged on the server, the record-level compare sets of two runs, the
 * cycle position of each object, and the cleaning workbook download. Fixture mode answers from ./runs-fixture so the
 * page carries 500 runs without a server.
 */
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { v2Get } from "@/lib/api/v2/client";
import { fixtureActive, useFixture } from "@/lib/api/v2/fixture";
import { downloadAuthenticated } from "@/lib/api/download";
import type { VersionHead } from "@/lib/api/v2/runs";
import { fixtureCycles, fixtureRun, fixtureRunsPage, fixtureSets, fixtureSummary } from "./runs-fixture";

export type Change = "new" | "resolved" | "regressed" | "persisting";
export type RunStatusFilter = "failed" | "complete" | "active";

export interface RunsQuery {
  system_id?: string | null;
  module?: string | null;
  status?: RunStatusFilter | null;
  limit?: number;
  offset?: number;
  sort?: string;
}

export interface RunsPage {
  versions: VersionHead[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
}

export interface SetsQuery {
  v2: string;
  v1?: string | null;
  change?: Change | null;
  check_id?: string | null;
  module?: string | null;
  limit?: number;
  offset?: number;
}

export interface CompareRecord {
  check_id: string;
  record_key: string;
  module: string;
  change: Change;
  reason: string | null;
  values_before: Record<string, unknown> | null;
  values_after: Record<string, unknown> | null;
}

export interface CompareSetsPage {
  v1: string;
  v2: string;
  records: CompareRecord[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
}

export interface CompareSummary {
  v1: string;
  v2: string;
  totals: Record<Change, number>;
  checks: Array<{ check_id: string; module: string; reason: string | null } & Record<Change, number>>;
}

export type CycleStep = "pull" | "clean" | "upload" | "score" | "compare";

export interface ObjectCycle {
  number: number;
  step: CycleStep;
  since: string | null;
  parent_run: string | null;
  downloaded_at: string | null;
  downloaded_by: string | null;
}

const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Record<string, string | number>;

export async function getRunsPage(q: RunsQuery): Promise<RunsPage> {
  if (fixtureActive()) return fixtureRunsPage(q);
  return v2Get<RunsPage>("/versions", { sort: "-run_at", ...clean(q) });
}

/** One run's head; the fixture answers its own ids, anything else goes to GET /versions/{id}. */
export async function getRun(id: string): Promise<VersionHead | null> {
  if (fixtureActive()) return fixtureRun(id);
  return v2Get<VersionHead>(`/versions/${encodeURIComponent(id)}`);
}

export async function getCompareSets(q: SetsQuery): Promise<CompareSetsPage> {
  if (fixtureActive()) return fixtureSets(q);
  return v2Get<CompareSetsPage>("/versions/compare/sets", clean(q));
}

export async function getCompareSummary(v1: string, v2: string, module?: string | null): Promise<CompareSummary> {
  if (fixtureActive()) return fixtureSummary(v1, v2);
  return v2Get<CompareSummary>("/versions/compare/sets/summary", clean({ v1, v2, module }));
}

/** GET /objects?run=: each object's cycle position in the lineage of that run's system. */
export async function getObjectCycles(run: string | null): Promise<Record<string, ObjectCycle>> {
  if (fixtureActive()) return fixtureCycles();
  const out = await v2Get<{ objects: Array<{ module: string; cycle?: ObjectCycle | null }> }>("/objects", { run: run ?? "latest" });
  return Object.fromEntries(out.objects.filter((o) => o.cycle).map((o) => [o.module, o.cycle as ObjectCycle]));
}

/** The cleaning workbook of one object in one run: every failing record with the fix column beside each finding. */
export function downloadCleaningWorkbook(runId: string, module: string): Promise<void> {
  if (fixtureActive()) return Promise.resolve();
  return downloadAuthenticated(`/api/v1/reports/${encodeURIComponent(runId)}/cleaning/${encodeURIComponent(module)}.xlsx`, `cleaning_${module}.xlsx`);
}

export const nextRunKeys = {
  page: (fx: boolean, q: RunsQuery) => ["next", "runs", fx, q.system_id ?? null, q.module ?? null, q.status ?? null, q.limit ?? 50, q.offset ?? 0, q.sort ?? null] as const,
  infinite: (fx: boolean, system: string | null, module: string | null) => ["next", "runs-inf", fx, system, module] as const,
  run: (fx: boolean, id: string) => ["next", "run", fx, id] as const,
  summary: (fx: boolean, a: string, b: string) => ["next", "sets-summary", fx, a, b] as const,
  sets: (fx: boolean, q: SetsQuery) => ["next", "sets", fx, q.v1 ?? null, q.v2, q.change ?? null, q.check_id ?? null, q.module ?? null, q.limit ?? 50, q.offset ?? 0] as const,
  cycles: (fx: boolean, run: string | null) => ["next", "cycles", fx, run] as const,
};

export function useRunsPage(q: RunsQuery, enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: nextRunKeys.page(fx, q), queryFn: () => getRunsPage(q), enabled, placeholderData: keepPreviousData });
}

export const SWITCHER_PAGE = 30;

/** The run switcher's list: 30 runs at a time, newest first, more on request. */
export function useRunsInfinite(system: string | null, module: string | null) {
  const fx = useFixture();
  return useInfiniteQuery({
    queryKey: nextRunKeys.infinite(fx, system, module),
    queryFn: ({ pageParam }) => getRunsPage({ system_id: system, module, limit: SWITCHER_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.next_offset ?? undefined,
    enabled: !!system,
  });
}

export function useRun(id: string | null) {
  const fx = useFixture();
  return useQuery({ queryKey: nextRunKeys.run(fx, id ?? ""), queryFn: () => getRun(id as string), enabled: !!id, staleTime: 60_000 });
}

/** Counts of one pair of runs. A finished pair never changes, so the answer is cached for the session and shared. */
export function useCompareSummary(v1: string | null | undefined, v2: string | null | undefined) {
  const fx = useFixture();
  return useQuery({ queryKey: nextRunKeys.summary(fx, v1 ?? "", v2 ?? ""), queryFn: () => getCompareSummary(v1 as string, v2 as string), enabled: !!v1 && !!v2 && v1 !== v2, staleTime: Infinity });
}

export function useCompareSets(q: SetsQuery | null) {
  const fx = useFixture();
  return useQuery({
    queryKey: q ? nextRunKeys.sets(fx, q) : ["next", "sets", "off"],
    queryFn: () => getCompareSets(q as SetsQuery),
    enabled: !!q && !!q.v1 && !!q.v2,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

export function useObjectCycle(run: string | null, module: string) {
  const fx = useFixture();
  const q = useQuery({ queryKey: nextRunKeys.cycles(fx, run), queryFn: () => getObjectCycles(run), staleTime: 15_000 });
  return { ...q, cycle: q.data?.[module] ?? null };
}
