"use client";

// The Records to fix tab: the object's failing records worst first on the left (server-paged with the work list's
// keyset cursor), the selected record's fix panel on the right. The selection lives in the URL (`?record=<key>`);
// without it the first record is selected. Filters live in the URL too: `issue`, `sev`, `status`, `mine`,
// `suggested`, `due`; the search box is local and debounced.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, EmptyState, ErrorState, Input, Mono, Notice, Pill, Select, SeverityDot, Skeleton, Stat, isSeverity } from "@/design";
import { RecordPanel, workRecordKey } from "@/components/work/record-panel";
import { STATUS, STATUS_ORDER, dueLabel } from "@/components/work/status";
import { buildWorklist, getWorkGroups, getWorkRecords, type RecordFilter, type WorkObject, type WorkRecord, type WorkRecordDetail, type WorkStatus } from "@/lib/api/work";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { FilterChips } from "../_header";
import { recordCount, workSummaryQuery } from "../_work";
import { STALE_MS, fixSheetHref } from "./_shared";

const SEVERITIES = (["critical", "high", "medium", "low"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
const STATUS_OPTIONS = [{ value: "open", label: "Still open" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS[s].label }))];
const FILTER_KEYS = ["issue", "sev", "status", "mine", "suggested", "due"] as const;
const ALL_ISSUES = "all";

const isStatus = (s: string | null): s is WorkStatus => !!s && (STATUS_ORDER as string[]).includes(s);

/** The URL of the object page with `patch` applied (null deletes a key). */
function useHrefWith(object: string) {
  const search = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) params.set(k, v); else params.delete(k); }
    const q = params.toString();
    return q ? `/objects/${object}?${q}` : `/objects/${object}`;
  };
}

/**
 * The compact strip above the object's tabs: its records failing a check, how many of those are critical, how many
 * carry a suggested value and how many are overdue (the DQS is the header's ring). The counts come from the work
 * list; before it is built, the first tile shows the run's rule failures (summed over rules) and says so.
 */
export function FixStrip({ object, summary, work, loading }: {
  object: string; summary: ObjectSummary | undefined; work: WorkObject | undefined; loading: boolean;
}) {
  const hrefWith = useHrefWith(object);
  const fix = (patch: Record<string, string | null>) =>
    hrefWith({ tab: "fix", record: null, ...Object.fromEntries(FILTER_KEYS.map((k) => [k, null])), ...patch });
  const failing = work?.open ?? (loading ? undefined : summary?.affected_records);
  return (
    <div className="m-stat-grid" data-testid="fix-strip">
      <Stat label={work || loading ? "Records failing" : "Rule failures"} value={failing == null ? "—" : failing.toLocaleString()} href={fix({})} loading={loading && !work} />
      <Stat
        label="Critical"
        value={work ? work.critical.toLocaleString() : "—"}
        tone={work ? (work.critical > 0 ? "no-go" : "go") : undefined}
        href={work && work.critical > 0 ? fix({ sev: "critical" }) : undefined}
        loading={loading && !work}
      />
      <Stat
        label="With a suggestion"
        value={work ? work.proposed.toLocaleString() : "—"}
        hint={work && work.open > 0 ? `${Math.round((work.proposed / work.open) * 100)}% of records failing` : undefined}
        href={work && work.proposed > 0 ? fix({ suggested: "1" }) : undefined}
        loading={loading && !work}
      />
      <Stat
        label="Overdue"
        value={work ? work.overdue.toLocaleString() : "—"}
        tone={work ? (work.overdue > 0 ? "no-go" : "go") : undefined}
        href={work && work.overdue > 0 ? fix({ due: "overdue" }) : undefined}
        loading={loading && !work}
      />
    </div>
  );
}

function BuildNotice({ run }: { run: string }) {
  const { can } = useRole();
  const qc = useQueryClient();
  const [queued, setQueued] = useState(false);
  // Poll the summary while the build runs; the tab fills in once it reports built.
  useQuery({ ...workSummaryQuery(run), refetchInterval: queued ? 5_000 : false });
  const m = useMutation({
    mutationFn: () => buildWorklist(run),
    onSuccess: () => {
      setQueued(true);
      toast.success("Building the work list. The records appear here when it finishes.");
      void qc.invalidateQueries({ queryKey: ["work"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const analyse = can("analyse");
  return (
    <Notice
      tone="info"
      title="The work list for this run is not built yet"
      action={analyse && !queued ? <Button pending={m.isPending} onClick={() => m.mutate()}>Build the work list</Button> : null}
    >
      {queued
        ? "Building now. The records to fix appear here when it finishes."
        : analyse
          ? "Build it to list this object's failing records one by one, with what is wrong and the suggested value."
          : "Ask someone who can run analyses to build it. Until then the Overview and Rules tabs show what fails."}
    </Notice>
  );
}

function RecordRow({ r, on, onSelect }: { r: WorkRecord; on: boolean; onSelect: () => void }) {
  const due = r.status === "to_fix" ? dueLabel(r.due_at) : null;
  const status = STATUS[r.status] ?? STATUS.to_fix;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={on ? "true" : undefined}
        data-record-row={r.record_key}
        data-testid="fix-row"
        className="flex w-full flex-col gap-1 border-l-2 border-transparent px-3 py-2 text-left hover:bg-[var(--m-sheet-raised)] aria-[current=true]:border-[var(--m-accent)] aria-[current=true]:bg-[var(--m-accent-soft)]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <SeverityDot severity={isSeverity(r.severity) ? r.severity : "low"} />
          <span className="min-w-0 flex-1 truncate font-medium m-ink">{r.name ?? <Mono inline>{r.record_key}</Mono>}</span>
          <Pill tone={status.tone}>{status.label}</Pill>
        </span>
        {r.name ? <span className="truncate m-text-meta m-ink-3"><Mono inline>{r.record_key}</Mono></span> : null}
        <span className="truncate m-text-meta m-ink-2">
          {r.top_message ?? "Fails a check"}{r.issues > 1 ? `, and ${r.issues - 1} more ${r.issues === 2 ? "issue" : "issues"}` : ""}
        </span>
        {r.top_field || r.proposed > 0 || due || r.assignee_email ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2 m-text-meta m-ink-3">
            {r.top_field ? <Mono inline>{r.top_field}</Mono> : null}
            {r.proposed > 0 ? <Pill tone="info">{r.proposed === 1 ? "Suggestion" : `${r.proposed} suggestions`}</Pill> : null}
            {due ? <Pill tone={due.tone}>{due.label}</Pill> : null}
            {r.assignee_email ? <span className="truncate">{r.assignee_email}</span> : null}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** Toggle chips that each switch one URL flag on or off. */
function ShowChips({ items }: { items: { label: string; on: boolean; toggle: () => void }[] }) {
  return (
    <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-2">
      <span className="m-text-meta m-ink-3">Show</span>
      {items.map((i) => (
        <button key={i.label} type="button" className="m-choice" aria-pressed={i.on} onClick={i.toggle}>{i.label}</button>
      ))}
    </div>
  );
}

export function RecordsToFix({ object, run }: { object: string; run: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const hrefWith = useHrefWith(object);
  const get = (k: string) => search?.get(k) ?? null;

  const issue = get("issue");
  const sevRaw = get("sev");
  const sev = SEVERITIES.find((s) => s.value === sevRaw)?.value ?? null;
  const statusRaw = get("status");
  const status: WorkStatus | "open" = isStatus(statusRaw) ? statusRaw : "open";
  const mine = get("mine") === "1";
  const suggested = get("suggested") === "1";
  const overdue = get("due") === "overdue";
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const summary = useQuery(workSummaryQuery(run));
  const groups = useQuery({
    queryKey: ["work", "groups", run, object],
    queryFn: () => getWorkGroups({ version_id: run, module: object }),
    enabled: !!run,
    staleTime: STALE_MS,
    retry: false,
    meta: { ignoreError: true },
  });
  const filter: RecordFilter = {
    version_id: run, module: object, check_id: issue ?? undefined, severity: sev ?? undefined, status,
    assigned: mine ? "me" : undefined, proposed: suggested || undefined, due: overdue ? "overdue" : undefined, q: q || undefined,
  };
  const records = useInfiniteQuery({
    queryKey: ["work", "records", run, object, filter],
    queryFn: ({ pageParam }) => getWorkRecords({ ...filter, after: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    // Wait for the summary: a run without a work list offers to build it instead. If the summary fails, read anyway.
    enabled: !!run && (summary.data?.built === true || summary.isError),
    staleTime: STALE_MS,
  });

  const items = records.data?.pages.flatMap((p) => p.items) ?? [];
  const first = records.data?.pages[0];
  const wanted = get("record");
  const selected = wanted ?? items[0]?.record_key ?? null;
  const filtered = !!(issue || sev || status !== "open" || mine || suggested || overdue || q);

  const select = (key: string) => router.replace(hrefWith({ record: key }), { scroll: false });
  const setFilter = (patch: Record<string, string | null>) => router.replace(hrefWith({ ...patch, record: null }), { scroll: false });
  const clearFilters = () => { setText(""); setQ(""); setFilter(Object.fromEntries(FILTER_KEYS.map((k) => [k, null]))); };

  /** Select the record `step` rows away from `from`, loading the next page when stepping past the last row. */
  const move = async (step: 1 | -1, from: string | null = selected) => {
    const at = items.findIndex((i) => i.record_key === from);
    const next = items[at + step];
    if (next) return select(next.record_key);
    if (step === 1 && at === items.length - 1 && records.hasNextPage) {
      const r = await records.fetchNextPage();
      const more = r.data?.pages.flatMap((p) => p.items) ?? [];
      const n = more[at + 1];
      if (n) select(n.record_key);
    }
  };

  // After a decision, stay while the record still has issues to fix; once it has none, go to the next record.
  const onDecided = async () => {
    const key = selected;
    if (!key) return;
    const detailKey = workRecordKey(object, key, run);
    await qc.refetchQueries({ queryKey: detailKey, exact: true });
    const detail = qc.getQueryData<WorkRecordDetail>(detailKey);
    if (detail && detail.issues.some((i) => i.status === "to_fix")) return;
    await move(1, key);
  };

  // j / k or the arrow keys move through the list; Enter opens the full record page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.repeat && e.key === "Enter") return;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable],[role=dialog],[role=listbox],[role=menu],[role=combobox],[role=tablist]")) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); void move(1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); void move(-1); }
      else if (e.key === "Enter" && selected) {
        // Enter on a button or link elsewhere on the page keeps its own meaning; on a list row it opens the record.
        if (t?.closest("a,button,summary") && !t.closest("[data-record-row]")) return;
        e.preventDefault();
        router.push(fixSheetHref(object, run, t?.closest<HTMLElement>("[data-record-row]")?.dataset.recordRow ?? selected));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Keep the selected row in view as j / k move it.
  useEffect(() => {
    if (!selected) return;
    const el = document.querySelector<HTMLElement>(`[data-record-row="${CSS.escape(selected)}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  if (summary.isLoading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (summary.data && !summary.data.built) return <BuildNotice run={run} />;

  const issueOptions = [
    { value: ALL_ISSUES, label: "All issues" },
    ...(groups.data?.groups ?? []).map((g) => ({ value: g.check_id, label: `${g.message ?? g.check_id} (${g.open.toLocaleString()})` })),
  ];
  const listBody = records.isPending ? (
    <div aria-busy="true" className="px-3"><Skeleton height={320} /></div>
  ) : records.isError ? (
    <ErrorState {...apiErrorState(records.error)} onRetry={() => void records.refetch()} />
  ) : items.length === 0 ? (
    filtered ? (
      <EmptyState variant="inline" title="No records match" detail="No record fits the current filters." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
    ) : null
  ) : (
    <>
      <ul aria-label="Records to fix" className="flex flex-col overflow-y-auto [max-height:min(70vh,44rem)]">
        {items.map((r) => <RecordRow key={r.record_key} r={r} on={r.record_key === selected} onSelect={() => select(r.record_key)} />)}
      </ul>
      {records.hasNextPage ? (
        <div className="px-3 pt-2">
          <Button variant="secondary" pending={records.isFetchingNextPage} onClick={() => void records.fetchNextPage()}>Load more</Button>
        </div>
      ) : null}
    </>
  );

  if (records.isSuccess && items.length === 0 && !filtered) {
    return (
      <EmptyState
        title="Every record passes"
        ghost="list"
        detail="No record of this object fails a check in this run."
        action={<Button render={<Link href={hrefWith({ tab: "rules", record: null })}>Open rules</Link>} />}
      />
    );
  }

  return (
    <div className="grid [gap:var(--m-section-gap)] [grid-template-columns:minmax(0,1fr)] @5xl:[grid-template-columns:400px_minmax(0,1fr)]" data-testid="records-to-fix">
      <div className="min-w-0">
        <Card
          title="Records to fix"
          meta={first ? `${items.length.toLocaleString()} of ${recordCount(first.total, first.total_capped)}` : undefined}
          padding="sm"
        >
          <div className="flex flex-col gap-3 px-3 pb-3">
            <Input type="search" aria-label="Search records" placeholder="Search by name or key" value={text} onChange={(e) => setText(e.target.value)} />
            {issueOptions.length > 1 ? (
              <Select label="Issue" value={issue ?? ALL_ISSUES} options={issueOptions} onValueChange={(v) => setFilter({ issue: v === ALL_ISSUES ? null : v })} className="m-input inline-flex w-full items-center justify-between gap-2" />
            ) : null}
            <FilterChips label="Severity" value={sev} options={SEVERITIES} onChange={(v) => setFilter({ sev: v })} />
            <Select label="Status" value={status} options={STATUS_OPTIONS} onValueChange={(v) => setFilter({ status: v === "open" ? null : v })} />
            <ShowChips items={[
              { label: "Assigned to me", on: mine, toggle: () => setFilter({ mine: mine ? null : "1" }) },
              { label: "Has a suggestion", on: suggested, toggle: () => setFilter({ suggested: suggested ? null : "1" }) },
              { label: "Overdue", on: overdue, toggle: () => setFilter({ due: overdue ? null : "overdue" }) },
            ]} />
          </div>
          {listBody}
        </Card>
      </div>
      <div className="min-w-0">
        {selected ? (
          <RecordPanel
            key={selected}
            module={object}
            recordKey={selected}
            run={run}
            onDecided={() => void onDecided()}
            footer={<p className="m-text-meta m-ink-3">Press j or k to move between records, Enter to open the full record.</p>}
          />
        ) : null}
      </div>
    </div>
  );
}
