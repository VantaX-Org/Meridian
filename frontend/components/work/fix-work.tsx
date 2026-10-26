"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, RowSelectionState, SortingState } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Button, Card, ConfirmDialog, DataTable, Dialog, Drawer, EmptyState, ErrorState, ExportMenu, FilterChip, Input, Mono, Notice, Pill,
  RankedRow, Select, SeverityDot, Skeleton, Stat, Switch, Textarea, isSeverity, type CellMeta, type TableView,
} from "@/design";
import { useRole } from "@/hooks/use-role";
import { DayOneAction, useDayOne } from "@/hooks/use-day-one";
import {
  acceptAllInGroup, buildWorklist, decide, downloadFixSheet, downloadFixSheetByObject, getWorkGroups, getWorkRecords, getWorkSummary, importFixSheet,
  setGroupValue, type Decision, type RecordFilter, type WorkGroup, type WorkRecord,
} from "@/lib/api/work";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName, plural } from "@/lib/format";
import { getVersion } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";
import { RunScope } from "@/components/run-scope";
import { useRunList } from "@/hooks/use-run-list";
import { stateScopeLine } from "@/lib/current-state";
import { keyBelongsElsewhere } from "@/lib/inbox-keys";
import { RecordPanel, invalidateAfterDecision, toastDraftBatch } from "./record-panel";
import { STATUS, STATUS_ORDER, dueLabel } from "./status";

/** Records per request; the queue loads the next page as the table nears its end (or `j` passes the last row). */
const PAGE = 200;
const DAY = 86_400_000;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const SEVERITY_LABEL: Record<string, string> = { blocking: "Critical and high" };
const STATUS_FILTERS = ["open", ...STATUS_ORDER, "all"] as const;
const STATUS_FILTER_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  open: "Still open", all: "Every status", ...Object.fromEntries(STATUS_ORDER.map((s) => [s, STATUS[s].label])) as Record<(typeof STATUS_ORDER)[number], string>,
};
/** The queue's own filters in the URL: what a saved view holds and replaces. The scope bar's run and object stay. */
const VIEW_KEYS = ["check", "sev", "st", "mine", "assignee", "sugg", "due", "system", "part", "q", "sort"] as const;

/** Severity, then age with the oldest first. */
const DEFAULT_SORT: SortingState = [{ id: "severity", desc: false }, { id: "age", desc: true }];
const PRESET_VIEWS: TableView[] = [
  { name: "Mine, open, oldest first", visibility: {}, dense: true, sorting: [{ id: "age", desc: true }], params: { mine: "1" } },
  { name: "Critical", visibility: {}, dense: true, sorting: DEFAULT_SORT, params: { sev: "critical" } },
  { name: "Has a suggestion", visibility: {}, dense: true, sorting: DEFAULT_SORT, params: { sugg: "1" } },
];

/** `?sort=severity,-age`: column ids, a leading minus for descending. */
const encodeSort = (s: SortingState): string => s.map((x) => `${x.desc ? "-" : ""}${x.id}`).join(",");
const decodeSort = (v: string): SortingState =>
  v ? v.split(",").filter(Boolean).map((x) => ({ id: x.replace(/^-/, ""), desc: x.startsWith("-") })) : DEFAULT_SORT;

/** `module|record_key` for the URL's ?record=. */
const recordId = (r: Pick<WorkRecord, "module" | "record_key">) => `${r.module}|${r.record_key}`;
const splitRecord = (v: string | null): [string, string] | null => {
  const i = v ? v.indexOf("|") : -1;
  return v && i > 0 ? [v.slice(0, i), v.slice(i + 1)] : null;
};

/** Whole days since the record's oldest failing issue was first seen; null when the server does not say. */
const ageDays = (r: WorkRecord, now: number): number | null => {
  const t = r.first_seen_at ? Date.parse(r.first_seen_at) : NaN;
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY));
};

/** Sort keys per column; nulls always last. */
const SORT_VALUE: Record<string, (r: WorkRecord, now: number) => string | number | null> = {
  record: (r) => (r.name ?? r.record_key).toLowerCase(),
  rule: (r) => (r.top_message ?? r.checks[0] ?? "").toLowerCase(),
  severity: (r) => SEV_RANK[r.severity] ?? 4,
  age: ageDays,
  due: (r) => (r.due_at ? Date.parse(r.due_at) : null),
  assignee: (r) => r.assignee_email?.toLowerCase() ?? null,
  suggested: (r) => r.suggested_value ?? null,
};

/** The loaded records in the table's order, the order j / k walk. Ties keep the server's worst-first order. */
export function sortRecords(items: WorkRecord[], sorting: SortingState, now: number = Date.now()): WorkRecord[] {
  const keys = sorting.filter((s) => SORT_VALUE[s.id]);
  if (!keys.length) return items;
  return items.map((r, i) => ({ r, i })).sort((a, b) => {
    for (const k of keys) {
      const va = SORT_VALUE[k.id](a.r, now);
      const vb = SORT_VALUE[k.id](b.r, now);
      if (va === vb) continue;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = va < vb ? -1 : 1;
      return k.desc ? -c : c;
    }
    return a.i - b.i;
  }).map((x) => x.r);
}

/** True below xl, where the page has no room for the record panel beside the queue: it opens as a sheet. */
const NARROW = "(max-width: 1279px)";
function subscribeNarrow(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(NARROW);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
const narrowSnapshot = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW).matches;
const useNarrow = () => useSyncExternalStore(subscribeNarrow, narrowSnapshot, () => false);

function useFilters() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => search?.get(k) ?? "";
  const filter: RecordFilter = {
    version_id: get("run") || undefined,
    module: get("module") || get("object") || undefined,
    check_id: get("check") || undefined,
    severity: get("sev") || undefined,
    status: get("st") || "open",
    assigned: get("mine") ? "me" : get("assignee") || undefined,
    proposed: get("sugg") ? true : undefined,
    due: get("due") === "overdue" ? "overdue" : undefined,
    system: get("system") || undefined,
    part: get("part") || undefined,
    q: get("q") || undefined,
  };
  const set = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(search?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [search, router, pathname]);
  const viewParams = Object.fromEntries(VIEW_KEYS.map((k) => [k, get(k)]).filter(([, v]) => v));
  return { filter, selected: splitRecord(search?.get("record") ?? null), set, sorting: decodeSort(get("sort")), viewParams, fromObject: !get("module") && !!get("object") };
}

function GroupList({ groups, active, onPick }: { groups: WorkGroup[]; active: string | undefined; onPick: (check: string | null) => void }) {
  const top = Math.max(1, ...groups.map((g) => g.open));
  return (
    <nav aria-label="Issues" className="flex flex-col">
      <button type="button" onClick={() => onPick(null)} aria-current={!active ? "true" : undefined}
        className={`flex items-center justify-between rounded-[var(--m-radius-control)] px-3 py-2 text-left m-text-body ${!active ? "bg-[var(--m-accent-soft)] m-ink" : "m-ink-2 hover:bg-[var(--m-sheet-raised)]"}`}>
        <span>Every issue</span>
      </button>
      <ul aria-label="Issues ranked by open records" className="flex flex-col">
        {groups.map((g) => (
          <RankedRow
            key={g.check_id}
            tone={isSeverity(g.severity) ? g.severity : "low"}
            onSelect={() => onPick(g.check_id)}
            selected={active === g.check_id}
            testId="work-group"
            label={
              <span className="flex min-w-0 items-center gap-2">
                <SeverityDot severity={isSeverity(g.severity) ? g.severity : "low"} />
                <span className="min-w-0 flex-1 truncate">{g.message ?? g.check_id}</span>
              </span>
            }
            magnitude={g.open.toLocaleString()}
            share={(g.open / top) * 100}
            meta={<span className="truncate">{formatModuleName(g.module)}{g.field ? <>, <Mono inline>{g.field}</Mono></> : null}{g.proposed ? <>, {g.proposed.toLocaleString()} suggested</> : null}</span>}
          />
        ))}
      </ul>
    </nav>
  );
}

const DASH = <span className="m-ink-3">—</span>;

/** The queue's columns: Record, Rule, Severity, Age, Due, Assignee, Suggested value. Sorting is the page's (`sortRecords`). */
function queueColumns(now: number): ColumnDef<WorkRecord>[] {
  return [
    {
      id: "record", header: "Record", accessorFn: (r) => r.name ?? r.record_key, meta: { sticky: "start" } satisfies CellMeta,
      cell: ({ row: { original: r } }) => (
        <span className="flex w-[200px] min-w-0 items-baseline gap-2" title={r.name ? `${r.name} ${r.record_key}` : r.record_key}>
          {r.name ? <span className="max-w-[110px] shrink-0 truncate">{r.name}</span> : null}
          <span className="min-w-0 shrink truncate m-text-meta m-ink-3"><Mono inline>{r.record_key}</Mono></span>
        </span>
      ),
    },
    {
      id: "rule", header: "Rule", accessorFn: (r) => r.top_message ?? r.checks[0] ?? "",
      cell: ({ row: { original: r } }) => (
        <span className="flex w-[210px] min-w-0 items-baseline gap-2" title={r.top_message ?? undefined}>
          <span className="min-w-0 shrink truncate">{r.top_message ?? r.checks[0]}</span>
          <span className="shrink-0 m-text-meta m-ink-3"><Mono inline>{r.checks[0]}</Mono>{r.issues > 1 ? ` +${r.issues - 1}` : null}</span>
        </span>
      ),
    },
    {
      id: "severity", header: "Severity", accessorFn: (r) => r.severity, meta: { severity: true } satisfies CellMeta,
      cell: ({ row: { original: r } }) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <SeverityDot severity={isSeverity(r.severity) ? r.severity : "low"} />{r.severity[0].toUpperCase() + r.severity.slice(1)}
        </span>
      ),
    },
    {
      id: "age", header: "Age", accessorFn: (r) => ageDays(r, now), meta: { numeric: true } satisfies CellMeta,
      cell: ({ row: { original: r } }) => {
        const d = ageDays(r, now);
        return d === null ? DASH : <span className="whitespace-nowrap" title={`First seen ${formatDate(r.first_seen_at)}`}>{d} d</span>;
      },
    },
    {
      // Due only applies while nobody has decided a value; after that the cell says where the fix is.
      id: "due", header: "Due", accessorFn: (r) => r.due_at ?? "",
      cell: ({ row: { original: r } }) => {
        if (r.status !== "to_fix") return <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>;
        const due = dueLabel(r.due_at, now);
        if (due) return <Pill tone={due.tone}>{due.label}</Pill>;
        return r.due_at ? <span className="whitespace-nowrap">{formatDate(r.due_at)}</span> : DASH;
      },
    },
    {
      id: "assignee", header: "Assignee", accessorFn: (r) => r.assignee_email ?? "", meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row: { original: r } }) => (r.assignee_email ? <span className="block max-w-[150px] truncate" title={r.assignee_email}>{r.assignee_email}</span> : DASH),
    },
    {
      id: "suggested", header: "Suggested value", accessorFn: (r) => r.suggested_value ?? "", meta: { priority: "low" } satisfies CellMeta,
      cell: ({ row: { original: r } }) => (r.suggested_value != null
        ? <span className="block max-w-[120px] truncate" title={r.suggested_value}><Mono inline>{r.suggested_value}</Mono></span>
        : r.proposed ? <span className="m-ink-3">{plural(r.proposed, "suggestion")}</span> : DASH),
    },
  ];
}

function SignOffDialog({ open, onOpenChange, count, pending, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; count: number; pending: boolean; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Mark ${plural(count, "record")} not an issue`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Keep them open</Button>
        <Button pending={pending} disabled={!reason.trim()} onClick={() => onConfirm(reason)}>Mark not an issue</Button></>}>
      <Textarea aria-label="Reason" placeholder="Why are these not an issue? The reason is kept in each record's history." value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
    </Dialog>
  );
}

function SetValueDialog({ group, open, onOpenChange, run }: { group: WorkGroup; open: boolean; onOpenChange: (o: boolean) => void; run?: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [onlyBlank, setOnlyBlank] = useState(true);
  const m = useMutation({
    mutationFn: () => setGroupValue(group.check_id, value, onlyBlank, run),
    onSuccess: (r) => { toastDraftBatch(`${plural(r.updated, "record")} set to "${value}": they wait in your draft batch for approval`); onOpenChange(false); invalidateAfterDecision(qc); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Set one value for the whole issue"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Leave the records as they are</Button>
        <Button pending={m.isPending} disabled={!value.trim()} onClick={() => m.mutate()}>Set value</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="m-text-body m-ink-2">{group.message} {group.field ? <Mono inline>{group.field}</Mono> : null}. Every open record of this issue gets the value; a second person approves the batch before it goes to SAP.</p>
        <Input aria-label="Value" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <Switch checked={onlyBlank} onCheckedChange={setOnlyBlank} label="Only records where the field is blank" />
      </div>
    </Dialog>
  );
}

/**
 * Decisions on records of several runs (the current state): one request per run, each decision to the run its
 * record was found in. Counts add up; the draft batch is the user's one draft.
 */
export async function decideInRuns(items: Decision[], runOf: (module: string) => string | undefined): Promise<{ updated: number; draft_batch_id: string | null }> {
  const byRun = new Map<string | undefined, Decision[]>();
  for (const d of items) byRun.set(runOf(d.module), [...(byRun.get(runOf(d.module)) ?? []), d]);
  let updated = 0;
  let draft: string | null = null;
  for (const [run, ds] of byRun) {
    const out = await decide(ds, run);
    updated += out.updated;
    draft = out.draft_batch_id ?? draft;
  }
  return { updated, draft_batch_id: draft };
}

/** No finished run: the tenant's next day-one step (import, ask for a connection, extract, or the run in progress), never a dead end. */
function NoRunYet() {
  const { step } = useDayOne();
  return (
    <EmptyState
      title="No finished run yet"
      detail={`Fix work lists the records a run found failing. ${step?.detail ?? "Load data or connect a system, then run the checks."}`}
      action={<DayOneAction step={step} fallbackHref="/runs" fallbackLabel="Open runs" />}
    />
  );
}

/**
 * Fix work: every record that fails a check: without `?run=` the current state (every object at its own latest run,
 * as Home counts them), with `?run=` that run alone, with what is wrong and what the value should be. Pick an issue on
 * the left (or every issue), a record in the dense queue in the middle (severity, then the oldest first, unless a
 * header or a saved view says otherwise), decide on the right; the next record comes up by itself. Every filter, the
 * sort and the record are in the URL. Keyboard: j / k move, a accepts the suggested values, t takes the record, u
 * undoes, Enter opens it.
 */
export function FixWork() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canFix = can("apply");
  const canSignOff = can("approve");
  const { filter, selected, set, sorting, viewParams, fromObject } = useFilters();
  const router = useRouter();
  const narrow = useNarrow();
  const run = filter.version_id;
  const fileRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<RowSelectionState>({});
  const [signOff, setSignOff] = useState(false);
  const [acceptAll, setAcceptAll] = useState(false);
  const [setValueOpen, setSetValueOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Ages are counted from one moment per mount, so a re-render never reorders the queue under the cursor.
  const [now] = useState(() => Date.now());
  const columns = useMemo(() => queueColumns(now), [now]);

  const summary = useQuery({ queryKey: ["work", "summary", run ?? "current"], queryFn: () => getWorkSummary(run), retry: false });
  // The run the counts belong to, named above them; the current state names its objects and newest run instead.
  const shownRunId = summary.data?.version_id ?? undefined;
  const shownRun = useQuery({ queryKey: queryKeys.run(shownRunId ?? ""), queryFn: () => getVersion(shownRunId ?? ""), enabled: !!shownRunId, meta: { ignoreError: true } });
  const runList = useRunList();
  const stateIds = new Set(run ? [] : summary.data?.version_ids ?? []);
  const newestOfState = (runList.data?.versions ?? []).filter((v) => stateIds.has(v.id)).sort((a, b) => (a.run_at < b.run_at ? 1 : -1))[0];
  const groups = useQuery({
    queryKey: ["work", "groups", run ?? "current", filter.module ?? "", filter.severity ?? ""],
    queryFn: () => getWorkGroups({ version_id: run, module: filter.module, severity: filter.severity }),
    enabled: summary.isSuccess,
  });
  const records = useInfiniteQuery({
    queryKey: ["work", "records", filter],
    queryFn: ({ pageParam }) => getWorkRecords({ ...filter, after: pageParam, limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    enabled: summary.isSuccess,
  });
  const loaded = useMemo(() => records.data?.pages.flatMap((p) => p.items) ?? [], [records.data]);
  const sortKey = encodeSort(sorting);
  const items = useMemo(() => sortRecords(loaded, decodeSort(sortKey), now), [loaded, sortKey, now]);
  const total = records.data?.pages[0]?.total ?? 0;
  const capped = records.data?.pages[0]?.total_capped ?? false;
  const activeGroup = groups.data?.groups.find((g) => g.check_id === filter.check_id);
  const loadMore = useCallback(() => {
    if (records.hasNextPage && !records.isFetchingNextPage) void records.fetchNextPage();
  }, [records]);

  // Without a selection, the first record is selected; the selection survives paging.
  const selectedId = selected ? `${selected[0]}|${selected[1]}` : items[0] ? recordId(items[0]) : null;
  const index = items.findIndex((r) => recordId(r) === selectedId);
  const current: Pick<WorkRecord, "module" | "record_key"> | undefined =
    index >= 0 ? items[index] : selected ? { module: selected[0], record_key: selected[1] } : undefined;
  const currentKey = current ? recordId(current) : null;
  const pick = useCallback((r: Pick<WorkRecord, "module" | "record_key"> | undefined) => { if (r) set({ record: recordId(r) }); }, [set]);
  const next = useCallback(() => {
    const n = items[index + 1];
    if (n) pick(n);
    if (index + 1 >= items.length - 1) loadMore();
  }, [items, index, pick, loadMore]);

  // The run a record's decisions go to: the pinned run, else the run its object is read from in the current state.
  const versionOf = useCallback((module: string): string | undefined =>
    run ?? summary.data?.objects.find((o) => o.module === module)?.version_id ?? items.find((r) => r.module === module)?.version_id,
  [run, summary.data, items]);
  const bulk = useMutation({
    mutationFn: (d: Decision[]) => decideInRuns(d, versionOf),
    onSuccess: (r) => { toast.success(`${plural(r.updated, "change")} saved`); setChecked({}); setSignOff(false); invalidateAfterDecision(qc); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const groupAccept = useMutation({
    mutationFn: (check: string) => acceptAllInGroup(check, run ?? groups.data?.groups.find((g) => g.check_id === check)?.version_id),
    onSuccess: (r) => { toastDraftBatch(`${plural(r.accepted, "suggested value")} accepted: they wait in your draft batch for approval`); setAcceptAll(false); invalidateAfterDecision(qc); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const build = useMutation({
    // One run, or each run of the current state whose work list is missing.
    mutationFn: async () => { for (const v of run ? [run] : summary.data?.unbuilt ?? []) await buildWorklist(v); },
    onSuccess: () => toast.success("Building the work list. It appears here in a few minutes."),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const upload = useMutation({
    mutationFn: (f: File) => importFixSheet(f, run),
    onSuccess: (r) => {
      toast.success(`${plural(r.rows, "row")} imported${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}`);
      if (r.skipped.length) toast.warning(r.skipped.slice(0, 5).join("; "));
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const selectedRows = items.filter((r) => checked[recordId(r)]);
  const ofRows = (action: Decision["action"], extra: Partial<Decision> = {}) =>
    selectedRows.map((r) => ({ module: r.module, record_key: r.record_key, action, ...extra }));

  // Keyboard triage: j/k (or arrows) move, a accepts the record's suggestions, t takes it, u undoes, Enter opens it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Fields, dialogs, menus and other buttons keep their keys; Enter opens only from a record row, the queue or the page.
      if (e.metaKey || e.ctrlKey || e.altKey || keyBelongsElsewhere(e, "[data-testid=work-record]")) return;
      // The queue moves its own cursor with the arrows (and reports it through onActiveRowChange).
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.defaultPrevented) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); next(); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); pick(items[Math.max(0, index - 1)]); }
      else if (!current) return;
      else if (e.key === "a" && canFix) bulk.mutate([{ module: current.module, record_key: current.record_key, action: "accept" }], { onSuccess: next });
      else if (e.key === "t" && can("assign")) bulk.mutate([{ module: current.module, record_key: current.record_key, action: "assign", assignee: "me" }]);
      else if (e.key === "u" && canFix) bulk.mutate([{ module: current.module, record_key: current.record_key, action: "undo" }]);
      else if (e.key === "Enter") { e.preventDefault(); const v = versionOf(current.module); router.push(`/objects/${current.module}/records/${encodeURIComponent(current.record_key)}${v ? `?run=${v}` : ""}`); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `current` is derived from currentKey
  }, [items, index, currentKey, next, pick, bulk, canFix, can, versionOf, router]);

  if (summary.isLoading) return <Skeleton height={480} />;
  if (summary.isError) {
    const st = (summary.error as { response?: { status?: number } })?.response?.status;
    if (st === 404) {
      return <NoRunYet />;
    }
    return <ErrorState {...apiErrorState(summary.error)} onRetry={() => summary.refetch()} />;
  }
  const s = summary.data!;
  const isCurrent = !run;
  const buildNotice = (
    <Notice tone="warning" title={isCurrent ? `${plural(s.unbuilt?.length ?? 0, "run")} of the current state ${s.unbuilt?.length === 1 ? "has" : "have"} no work list yet` : "This run's work list is not built yet"}
      action={can("analyse") ? <Button pending={build.isPending} onClick={() => build.mutate()}>Build the work list</Button> : undefined}>
      Runs from before this version have no work list{isCurrent ? ", so their objects are not listed here" : ""}. {can("analyse") ? "Build it once; it takes a few minutes for a large run." : "Ask an analyst to build it."}
    </Notice>
  );
  if (!s.built) return buildNotice;
  const t = s.totals;
  // The scope bar holds the object and the record search; a chip only for what it does not show.
  const chips: { label: string; value: string; key: string }[] = [
    fromObject && filter.module ? { label: "Object", value: formatModuleName(filter.module), key: "object" } : null,
    filter.check_id ? { label: "Issue", value: activeGroup?.message ?? filter.check_id, key: "check" } : null,
    filter.severity ? { label: "Severity", value: SEVERITY_LABEL[filter.severity] ?? filter.severity, key: "sev" } : null,
    filter.system ? { label: "System", value: filter.system === "upload" ? "uploads" : "one source system", key: "system" } : null,
    filter.assigned ? { label: "Assigned", value: filter.assigned === "me" ? "to me" : filter.assigned === "unassigned" ? "to nobody" : "to one person", key: filter.assigned === "me" ? "mine" : "assignee" } : null,
    filter.part ? { label: "Where", value: filter.part, key: "part" } : null,
    filter.proposed ? { label: "Has", value: "a suggested value", key: "sugg" } : null,
    filter.due ? { label: "Due", value: "overdue", key: "due" } : null,
    filter.q ? { label: "Search", value: filter.q, key: "q" } : null,
  ].filter((c): c is { label: string; value: string; key: string } => !!c);
  const clearFilters = () => set({ object: null, check: null, sev: null, mine: null, assignee: null, system: null, part: null, sugg: null, due: null, q: null, st: null, record: null });
  const applyView = (v: TableView) => set({
    ...Object.fromEntries(VIEW_KEYS.map((k) => [k, null])),
    ...v.params,
    sort: v.sorting.length && encodeSort(v.sorting) !== encodeSort(DEFAULT_SORT) ? encodeSort(v.sorting) : null,
    record: null,
  });
  const open = (r: WorkRecord) => { pick(r); if (narrow) setSheetOpen(true); };
  const panel = current ? <RecordPanel module={current.module} recordKey={current.record_key} run={versionOf(current.module)} onDecided={next} /> : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="fix-work">
      {isCurrent ? (
        <p className="m-text-body m-ink-2" data-testid="fix-scope">
          {newestOfState ? stateScopeLine(s.objects.length, newestOfState.run_at) : `Current state of ${plural(s.objects.length, "object")}`}, each object at its own latest run
        </p>
      ) : shownRun.data ? (
        <p className="m-text-body m-ink-2">
          <RunScope scope={{ run: shownRun.data, latestId: undefined, pinned: false, choices: [] }} hrefFor={(id) => (id ? `/fix?${new URLSearchParams({ run: id })}` : "/fix")} />
        </p>
      ) : null}
      {isCurrent && s.unbuilt?.length ? buildNotice : null}
      <div className="m-stat-grid @5xl:[grid-template-columns:repeat(4,minmax(0,1fr))]">
        <Stat label="Records to fix" value={t.open.toLocaleString()} hint={`${plural(t.issues, "issue")} across ${plural(s.objects.length, "object")}`} onClick={() => set({ st: null, sev: null, sugg: null, due: null })} />
        <Stat label="Critical" value={t.critical.toLocaleString()} tone={t.critical ? "no-go" : "go"} hint="critical severity" onClick={() => set({ sev: "critical" })} />
        <Stat label="With a suggested value" value={t.proposed.toLocaleString()} hint="accept in one step" onClick={() => set({ sugg: "1" })} />
        <Stat label="Overdue" value={t.overdue.toLocaleString()} tone={t.overdue ? "at-risk" : undefined} hint="past their due date" onClick={() => set({ due: "overdue" })} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select label="Severity" value={filter.severity ?? "all"} onValueChange={(v) => set({ sev: v === "all" ? null : v, record: null })}
          options={[{ value: "all", label: "Every severity" }, { value: "blocking", label: SEVERITY_LABEL.blocking }, ...SEVERITIES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))]} />
        <Select label="Status" value={filter.status ?? "open"} onValueChange={(v) => set({ st: v === "open" ? null : v, record: null })}
          options={STATUS_FILTERS.map((v) => ({ value: v, label: STATUS_FILTER_LABEL[v] }))} />
        <Switch checked={!!filter.assigned} onCheckedChange={(on) => set({ mine: on ? "1" : null, assignee: null, record: null })} label="Mine" />
        <Switch checked={!!filter.proposed} onCheckedChange={(on) => set({ sugg: on ? "1" : null, record: null })} label="Has a suggestion" />
        <div className="ml-auto flex flex-wrap gap-2">
          <ExportMenu options={[
            { format: "xlsx", label: "Fix sheet (.xlsx)", run: () => downloadFixSheet(filter) },
            { format: "xlsx", label: "Fix sheet, one sheet per object (.xlsx)", run: () => downloadFixSheetByObject(filter) },
          ]} />
          {canFix ? (
            <>
              <Button variant="secondary" pending={upload.isPending} onClick={() => fileRef.current?.click()}>Import fix sheet</Button>
              <input ref={fileRef} type="file" accept=".xlsx" hidden aria-label="Fix sheet file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
            </>
          ) : null}
        </div>
      </div>
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={() => set({ [c.key]: null, record: null })} />)}
          <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_minmax(0,380px)] 2xl:grid-cols-[320px_minmax(0,1fr)_minmax(0,460px)]">
        <Card title="Issues" meta={groups.data ? `${groups.data.total.toLocaleString()} ${isCurrent ? `across ${plural(s.objects.length, "object")}` : "in this run"}` : undefined} padding="sm">
          {groups.isLoading ? <Skeleton height={240} /> : groups.isError ? <ErrorState {...apiErrorState(groups.error)} onRetry={() => groups.refetch()} />
            : groups.data && groups.data.groups.length ? (
              <div className="max-h-[40vh] overflow-auto lg:max-h-[70vh]"><GroupList groups={groups.data.groups} active={filter.check_id} onPick={(c) => set({ check: c, record: null })} /></div>
            ) : <p className="m-text-body m-ink-3">No failing checks.</p>}
        </Card>

        <section aria-label="Records to fix" className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-text-h font-semibold m-ink">{activeGroup ? activeGroup.message ?? activeGroup.check_id : "Records to fix"}</h2>
            {records.data ? (
              <span className="m-text-meta m-ink-3">
                {capped ? "100,000+" : total.toLocaleString()} {total === 1 ? "record" : "records"}{loaded.length < total ? `, ${loaded.length.toLocaleString()} loaded` : ""}
              </span>
            ) : null}
          </div>
          {activeGroup && canFix ? (
            <span className="flex flex-wrap gap-2">
              {activeGroup.proposed ? <Button size="sm" onClick={() => setAcceptAll(true)}>Accept {activeGroup.proposed.toLocaleString()} suggested</Button> : null}
              <Button size="sm" variant="secondary" onClick={() => setSetValueOpen(true)}>Set one value</Button>
            </span>
          ) : null}
          {activeGroup?.truncated ? <Notice tone="info">The run kept the first 100,000 records of this check. Fix these, and the next run lists the rest.</Notice> : null}
          {records.isLoading ? <Skeleton height={360} /> : records.isError ? <ErrorState {...apiErrorState(records.error)} onRetry={() => records.refetch()} />
            : items.length === 0 ? (
              <Card padding="sm">
                <EmptyState variant="inline" title={chips.length || filter.status !== "open" ? "No records match these filters" : "Nothing left to fix"}
                  detail={chips.length ? "Clear a filter to see more." : `Every failing record ${isCurrent ? "of every object" : "in this run"} has a decision.`}
                  action={chips.length ? <Button variant="secondary" onClick={clearFilters}>Clear filters</Button> : undefined} />
              </Card>
            ) : (
              <>
                <DataTable
                  label="Records to fix"
                  tableId="fix-work-queue"
                  columns={columns}
                  data={items}
                  getRowId={recordId}
                  rowLabel={(r) => r.name ?? r.record_key}
                  rowTestId="work-record"
                  dense
                  hideSearch
                  hideExport
                  maxHeight="70vh"
                  manualSorting
                  sorting={sorting}
                  onSortingChange={(v) => set({ sort: v.length ? encodeSort(v) : null })}
                  activeRowId={selectedId}
                  onActiveRowChange={pick}
                  onRowClick={open}
                  onEndReached={loadMore}
                  presetViews={PRESET_VIEWS}
                  viewParams={viewParams}
                  onApplyView={applyView}
                  selection={checked}
                  onSelectionChange={setChecked}
                  bulkActions={canFix ? () => (
                    <>
                      <Button variant="ghost" pending={bulk.isPending} onClick={() => bulk.mutate(ofRows("accept"))}>Accept suggestions</Button>
                      {can("assign") ? <Button variant="ghost" onClick={() => bulk.mutate(ofRows("assign", { assignee: "me" }))}>Take them</Button> : null}
                      {can("assign") ? <Button variant="ghost" onClick={() => bulk.mutate(ofRows("assign", { assignee: "" }))}>Release</Button> : null}
                      {canSignOff ? <Button variant="ghost" onClick={() => setSignOff(true)}>Not an issue</Button> : null}
                      <Button variant="ghost" onClick={() => bulk.mutate(ofRows("undo"))}>Undo</Button>
                      <Button variant="ghost" onClick={() => setChecked({})}>Clear</Button>
                    </>
                  ) : undefined}
                />
                {records.isFetchingNextPage ? <p className="m-text-meta m-ink-3" role="status">Loading more records</p> : null}
                <p className="px-1 m-text-meta m-ink-3 max-[639px]:hidden">Keys: <kbd className="m-kbd">j</kbd> <kbd className="m-kbd">k</kbd> move, <kbd className="m-kbd">a</kbd> accept suggestions, <kbd className="m-kbd">t</kbd> take, <kbd className="m-kbd">u</kbd> undo, <kbd className="m-kbd">Enter</kbd> full record</p>
              </>
            )}
        </section>

        {narrow ? (
          <Drawer open={sheetOpen && !!current} onOpenChange={setSheetOpen} title="Record">
            {panel}
          </Drawer>
        ) : (
          <div className="xl:sticky xl:top-4 xl:self-start">
            {panel ?? <Card><p className="m-text-body m-ink-3">Pick a record to see what is wrong with it.</p></Card>}
          </div>
        )}
      </div>

      <SignOffDialog open={signOff} onOpenChange={setSignOff} count={selectedRows.length} pending={bulk.isPending}
        onConfirm={(reason) => bulk.mutate(ofRows("not_an_issue", { note: reason }))} />
      {activeGroup ? (
        <>
          <ConfirmDialog open={acceptAll} onOpenChange={setAcceptAll} title={`Accept ${activeGroup.proposed.toLocaleString()} suggested values`}
            body={<>Every open record of &ldquo;{activeGroup.message}&rdquo; with a suggested value gets it, in your draft batch. A second person approves the batch before anything goes to SAP, and you can undo any record.</>}
            confirmLabel="Accept them" pending={groupAccept.isPending} onConfirm={() => groupAccept.mutate(activeGroup.check_id)} />
          <SetValueDialog group={activeGroup} open={setValueOpen} onOpenChange={setSetValueOpen} run={run ?? activeGroup.version_id} />
        </>
      ) : null}
    </div>
  );
}
