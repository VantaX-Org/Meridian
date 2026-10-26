"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BulkBar, Button, Card, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, FilterChip, Input, Mono, Notice, Pill,
  RankedRow, Select, SeverityDot, Skeleton, Stat, Switch, Textarea, isSeverity,
} from "@/design";
import { useRole } from "@/hooks/use-role";
import { DayOneAction, useDayOne } from "@/hooks/use-day-one";
import {
  acceptAllInGroup, buildWorklist, decide, downloadFixSheet, downloadFixSheetByObject, getWorkGroups, getWorkRecords, getWorkSummary, importFixSheet,
  setGroupValue, type Decision, type RecordFilter, type WorkGroup, type WorkRecord,
} from "@/lib/api/work";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatModuleName, plural } from "@/lib/format";
import { getVersion } from "@/lib/api/versions";
import { queryKeys } from "@/lib/query-keys";
import { RunScope } from "@/components/run-scope";
import { useRunList } from "@/hooks/use-run-list";
import { stateScopeLine } from "@/lib/current-state";
import { keyBelongsElsewhere } from "@/lib/inbox-keys";
import { RecordPanel, invalidateAfterDecision, toastDraftBatch } from "./record-panel";
import { STATUS, STATUS_ORDER, dueLabel } from "./status";

const PAGE = 50;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEVERITY_LABEL: Record<string, string> = { blocking: "Critical and high" };
const STATUS_FILTERS = ["open", ...STATUS_ORDER, "all"] as const;
const STATUS_FILTER_LABEL: Record<(typeof STATUS_FILTERS)[number], string> = {
  open: "Still open", all: "Every status", ...Object.fromEntries(STATUS_ORDER.map((s) => [s, STATUS[s].label])) as Record<(typeof STATUS_ORDER)[number], string>,
};

/** `module|record_key` for the URL's ?record=. */
const recordId = (r: Pick<WorkRecord, "module" | "record_key">) => `${r.module}|${r.record_key}`;
const splitRecord = (v: string | null): [string, string] | null => {
  const i = v ? v.indexOf("|") : -1;
  return v && i > 0 ? [v.slice(0, i), v.slice(i + 1)] : null;
};

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
  return { filter, selected: splitRecord(search?.get("record") ?? null), set };
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

function RecordRow({ r, active, checked, onSelect, onCheck, canBulk }: {
  r: WorkRecord; active: boolean; checked: boolean; onSelect: () => void; onCheck: (on: boolean) => void; canBulk: boolean;
}) {
  const due = r.status === "to_fix" ? dueLabel(r.due_at) : null;
  return (
    <li data-testid="work-record" aria-current={active ? "true" : undefined}
      className={`flex items-start gap-3 border-b border-[var(--m-line)] px-3 py-2 ${active ? "bg-[var(--m-accent-soft)]" : "hover:bg-[var(--m-sheet-raised)]"}`}>
      {canBulk ? <span className="pt-1"><Checkbox aria-label={`Select ${r.name ?? r.record_key}`} checked={checked} onChange={(e) => onCheck(e.target.checked)} /></span> : null}
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="flex items-center gap-2">
          <SeverityDot severity={isSeverity(r.severity) ? r.severity : "low"} />
          <span className="truncate m-text-body font-medium m-ink">{r.name ?? <Mono inline>{r.record_key}</Mono>}</span>
        </span>
        {r.name ? <span className="pl-5 m-text-meta m-ink-3"><Mono inline>{r.record_key}</Mono></span> : null}
        <span className="pl-5 m-text-body m-ink-2">
          {r.top_message ?? r.checks[0]}{r.issues > 1 ? <span className="m-ink-3"> and {plural(r.issues - 1, "more issue")}</span> : null}
        </span>
        <span className="flex flex-wrap items-center gap-2 pl-5">
          <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
          {r.proposed ? <span className="m-text-meta m-ink-3">{plural(r.proposed, "suggested value")}</span> : null}
          {due ? <Pill tone={due.tone}>{due.label}</Pill> : null}
          {r.assignee_email ? <span className="m-text-meta m-ink-3">{r.assignee_email}</span> : null}
          <span className="m-text-meta m-ink-3">{formatModuleName(r.module)}</span>
        </span>
      </button>
    </li>
  );
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

/**
 * Fix work: every record that fails a check, worst first: without `?run=` the current state (every object at its
 * own latest run, as Home counts them), with `?run=` that run alone, with what is wrong and what the value
 * should be. Pick an issue on the left (or every issue), a record in the middle, decide on the right; the next
 * record comes up by itself. Keyboard: j / k move, a accepts the suggested values, t takes the record, u undoes.
 */
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

export function FixWork() {
  const qc = useQueryClient();
  const { can } = useRole();
  const canFix = can("apply");
  const canSignOff = can("approve");
  const { filter, selected, set } = useFilters();
  const router = useRouter();
  const run = filter.version_id;
  const fileRef = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [signOff, setSignOff] = useState(false);
  const [acceptAll, setAcceptAll] = useState(false);
  const [setValueOpen, setSetValueOpen] = useState(false);
  const [q, setQ] = useState(filter.q ?? "");

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
  const items = useMemo(() => records.data?.pages.flatMap((p) => p.items) ?? [], [records.data]);
  const total = records.data?.pages[0]?.total ?? 0;
  const capped = records.data?.pages[0]?.total_capped ?? false;
  const activeGroup = groups.data?.groups.find((g) => g.check_id === filter.check_id);

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
    else if (records.hasNextPage) void records.fetchNextPage();
  }, [items, index, pick, records]);

  // The run a record's decisions go to: the pinned run, else the run its object is read from in the current state.
  const versionOf = useCallback((module: string): string | undefined =>
    run ?? summary.data?.objects.find((o) => o.module === module)?.version_id ?? items.find((r) => r.module === module)?.version_id,
  [run, summary.data, items]);
  const bulk = useMutation({
    mutationFn: (d: Decision[]) => decideInRuns(d, versionOf),
    onSuccess: (r) => { toast.success(`${plural(r.updated, "change")} saved`); setChecked(new Set()); setSignOff(false); invalidateAfterDecision(qc); },
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

  const selectedRows = items.filter((r) => checked.has(recordId(r)));
  const ofRows = (action: Decision["action"], extra: Partial<Decision> = {}) =>
    selectedRows.map((r) => ({ module: r.module, record_key: r.record_key, action, ...extra }));

  // Keyboard triage: j/k (or arrows) move, a accepts the record's suggestions, t takes it, u undoes, Enter opens it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Fields, dialogs, menus and other buttons keep their keys; Enter opens only from a record row or the page.
      if (e.metaKey || e.ctrlKey || e.altKey || keyBelongsElsewhere(e, "[data-testid=work-record]")) return;
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
  const chips: { label: string; value: string; key: string }[] = [
    filter.module ? { label: "Object", value: formatModuleName(filter.module), key: "module" } : null,
    filter.check_id ? { label: "Issue", value: activeGroup?.message ?? filter.check_id, key: "check" } : null,
    filter.severity ? { label: "Severity", value: SEVERITY_LABEL[filter.severity] ?? filter.severity, key: "sev" } : null,
    filter.system ? { label: "System", value: filter.system === "upload" ? "uploads" : "one source system", key: "system" } : null,
    filter.assigned ? { label: "Assigned", value: filter.assigned === "me" ? "to me" : filter.assigned === "unassigned" ? "to nobody" : "to one person", key: filter.assigned === "me" ? "mine" : "assignee" } : null,
    filter.part ? { label: "Where", value: filter.part, key: "part" } : null,
    filter.proposed ? { label: "Has", value: "a suggested value", key: "sugg" } : null,
    filter.due ? { label: "Due", value: "overdue", key: "due" } : null,
    filter.q ? { label: "Search", value: filter.q, key: "q" } : null,
  ].filter((c): c is { label: string; value: string; key: string } => !!c);

  return (
    <div className="flex flex-col gap-4" data-testid="fix-work">
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
        <Select label="Object" value={filter.module ?? "all"} onValueChange={(v) => set({ module: v === "all" ? null : v, object: null, check: null, record: null })}
          options={[{ value: "all", label: "Every object" }, ...s.objects.map((o) => ({ value: o.module, label: `${formatModuleName(o.module)} (${o.open.toLocaleString()})` }))]} />
        <Select label="Severity" value={filter.severity ?? "all"} onValueChange={(v) => set({ sev: v === "all" ? null : v, record: null })}
          options={[{ value: "all", label: "Every severity" }, { value: "blocking", label: SEVERITY_LABEL.blocking }, ...SEVERITIES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))]} />
        <Select label="Status" value={filter.status ?? "open"} onValueChange={(v) => set({ st: v === "open" ? null : v, record: null })}
          options={STATUS_FILTERS.map((v) => ({ value: v, label: STATUS_FILTER_LABEL[v] }))} />
        <Switch checked={!!filter.assigned} onCheckedChange={(on) => set({ mine: on ? "1" : null, record: null })} label="Mine" />
        <Switch checked={!!filter.proposed} onCheckedChange={(on) => set({ sugg: on ? "1" : null, record: null })} label="Has a suggestion" />
        <form className="flex min-w-[220px] flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null, record: null }); }}>
          <Input aria-label="Find a record" placeholder="Find a record by key or name" value={q} onChange={(e) => setQ(e.target.value)} className="m-input flex-1" />
        </form>
        <div className="ml-auto flex flex-wrap gap-2">
          {can("export") ? (
            <>
              <Button variant="secondary" onClick={() => downloadFixSheet(filter).catch((e) => toast.error(apiErrorMessage(e)))}>Download fix sheet</Button>
              <Button variant="secondary" title="One sheet per object, with each record's value at risk"
                onClick={() => downloadFixSheetByObject(filter).catch((e) => toast.error(apiErrorMessage(e)))}>Download by object</Button>
            </>
          ) : null}
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
          {chips.map((c) => <FilterChip key={c.key} label={c.label} value={c.value} onRemove={() => { set({ [c.key]: null, ...(c.key === "module" ? { object: null } : {}), record: null }); if (c.key === "q") setQ(""); }} />)}
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); set({ module: null, object: null, check: null, sev: null, mine: null, assignee: null, system: null, part: null, sugg: null, due: null, q: null, st: null, record: null }); }}>Clear filters</Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)_minmax(0,440px)] 2xl:grid-cols-[400px_minmax(0,1fr)_minmax(0,480px)]">
        <Card title="Issues" meta={groups.data ? `${groups.data.total.toLocaleString()} ${isCurrent ? `across ${plural(s.objects.length, "object")}` : "in this run"}` : undefined} padding="sm">
          {groups.isLoading ? <Skeleton height={240} /> : groups.isError ? <ErrorState {...apiErrorState(groups.error)} onRetry={() => groups.refetch()} />
            : groups.data && groups.data.groups.length ? (
              <div className="max-h-[70vh] overflow-auto"><GroupList groups={groups.data.groups} active={filter.check_id} onPick={(c) => set({ check: c, record: null })} /></div>
            ) : <p className="m-text-body m-ink-3">No failing checks.</p>}
        </Card>

        <Card
          title={activeGroup ? activeGroup.message ?? activeGroup.check_id : "Records to fix"}
          meta={records.data ? `${capped ? "100,000+" : total.toLocaleString()} ${total === 1 ? "record" : "records"}, worst first` : undefined}
          actions={activeGroup && canFix ? (
            <span className="flex flex-wrap gap-2">
              {activeGroup.proposed ? <Button size="sm" onClick={() => setAcceptAll(true)}>Accept {activeGroup.proposed.toLocaleString()} suggested</Button> : null}
              <Button size="sm" variant="secondary" onClick={() => setSetValueOpen(true)}>Set one value</Button>
            </span>
          ) : undefined}
          padding="sm"
        >
          {activeGroup?.truncated ? <Notice tone="info">The run kept the first 100,000 records of this check. Fix these, and the next run lists the rest.</Notice> : null}
          {records.isLoading ? <Skeleton height={360} /> : records.isError ? <ErrorState {...apiErrorState(records.error)} onRetry={() => records.refetch()} />
            : items.length === 0 ? (
              <EmptyState variant="inline" title={chips.length || filter.status !== "open" ? "No records match these filters" : "Nothing left to fix"}
                detail={chips.length ? "Clear a filter to see more." : `Every failing record ${isCurrent ? "of every object" : "in this run"} has a decision.`}
                action={chips.length ? <Button variant="secondary" onClick={() => set({ module: null, object: null, check: null, sev: null, mine: null, assignee: null, system: null, part: null, sugg: null, due: null, q: null })}>Clear filters</Button> : undefined} />
            ) : (
              <>
                <ul className="max-h-[70vh] overflow-auto" aria-label="Records to fix">
                  {items.map((r) => (
                    <RecordRow key={recordId(r)} r={r} active={recordId(r) === selectedId} canBulk={canFix}
                      checked={checked.has(recordId(r))} onSelect={() => pick(r)}
                      onCheck={(on) => setChecked((prev) => { const n = new Set(prev); if (on) n.add(recordId(r)); else n.delete(recordId(r)); return n; })} />
                  ))}
                </ul>
                {records.hasNextPage ? (
                  <div className="flex justify-center p-3"><Button variant="secondary" pending={records.isFetchingNextPage} onClick={() => records.fetchNextPage()}>Show {PAGE} more</Button></div>
                ) : null}
                <p className="px-3 pt-2 m-text-meta m-ink-3">Keys: <kbd className="m-kbd">j</kbd> <kbd className="m-kbd">k</kbd> move, <kbd className="m-kbd">a</kbd> accept suggestions, <kbd className="m-kbd">t</kbd> take, <kbd className="m-kbd">u</kbd> undo, <kbd className="m-kbd">Enter</kbd> full record</p>
              </>
            )}
          <BulkBar count={selectedRows.length} actions={<>
            <Button variant="ghost" pending={bulk.isPending} onClick={() => bulk.mutate(ofRows("accept"))}>Accept suggestions</Button>
            {can("assign") ? <Button variant="ghost" onClick={() => bulk.mutate(ofRows("assign", { assignee: "me" }))}>Take them</Button> : null}
            {can("assign") ? <Button variant="ghost" onClick={() => bulk.mutate(ofRows("assign", { assignee: "" }))}>Release</Button> : null}
            {canSignOff ? <Button variant="ghost" onClick={() => setSignOff(true)}>Not an issue</Button> : null}
            <Button variant="ghost" onClick={() => bulk.mutate(ofRows("undo"))}>Undo</Button>
            <Button variant="ghost" onClick={() => setChecked(new Set())}>Clear</Button>
          </>} />
        </Card>

        <div className="lg:sticky lg:top-4 lg:self-start">
          {current ? <RecordPanel module={current.module} recordKey={current.record_key} run={versionOf(current.module)} onDecided={next} />
            : <Card><p className="m-text-body m-ink-3">Pick a record to see what is wrong with it.</p></Card>}
        </div>
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
