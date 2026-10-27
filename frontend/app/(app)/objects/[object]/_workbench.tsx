"use client";

// The Overview tab: a workbench. The failing rules ranked by records on the left, the selected rule's failing
// records on the right. The selection lives in the URL (`?rule=<id>`); without it the blocking rule is selected,
// else the worst critical rule, else the worst rule.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BELOW_LG, Button, Card, DataTable, DetailPane, DimensionBars, EmptyState, ErrorState, ExportMenu, Mono, Pager, RankedRow, SeverityDot, Skeleton, Stat, Status, isSeverity, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { exportFindingRecords } from "@/lib/api/findings";
import { createBatch } from "@/lib/api/remediation";
import { getRuleRanking, type RuleRow } from "@/lib/api/insights";
import type { ObjectRule } from "@/lib/api/v1/objects";
import { apiErrorState } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { rankedName, useRuleNames } from "@/lib/rule-name";
import { FilterChips } from "../_header";
import { PAGE_SIZE, STALE_MS, fixSheetHref, isBlocking, objectQuery, recordsQuery, useFixShortcut, useRecordColumns } from "./_shared";

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

type WorkRule = ObjectRule & { name: string | null; field: string | null; autoFixPct: number | null };

/** The rules' names, fields and auto-fix shares come from the insights ranking; the workbench reads without them if it fails. */
export function useRuleDetails(object: string, run: string) {
  return useQuery({
    queryKey: queryKeys.insights("rules", run, object, "workbench"),
    queryFn: () => getRuleRanking({ version_id: run, module: object, limit: 200 }),
    enabled: !!run,
    staleTime: STALE_MS,
    retry: false,
    meta: { ignoreError: true },
  });
}

function RulePane({ object, run, rule }: { object: string; run: string; rule: WorkRule }) {
  const router = useRouter();
  const search = useSearchParams();
  const [page, setPage] = useState(1);
  const grain = search.get("grain");
  const { data, isLoading, isError, error, refetch } = useQuery(recordsQuery(run, rule.check_id, page, grain));
  const records = data?.records;
  const canApply = useRole().can("apply");
  /** Drafts a fix batch for this rule in this run, or for the records ticked in the table. */
  const draft = useMutation({
    mutationFn: (keys: string[] | null) =>
      createBatch(`${rule.check_id} ${object}`, { check_id: rule.check_id, module: object, version_id: run, ...(keys ? { record_keys: keys } : {}) }),
    onSuccess: (b) => {
      toast.success(`Fix batch drafted with ${b.item_count.toLocaleString()} ${b.item_count === 1 ? "item" : "items"}`, {
        action: { label: "Open batch", onClick: () => router.push(`/fix?tab=batches&batch=${b.id}`) },
      });
    },
    onError: () => toast.error("Could not draft the fix batch"),
  });
  useFixShortcut(object, run, records?.[0]?.record_key);
  const columns = useRecordColumns(object, run, records);

  const grains = [...new Set((records ?? []).map((r) => r.grain).filter((g): g is string => !!g))].sort();
  const shown = (records ?? []).filter((r) => !grain || r.grain === grain);
  const setGrain = (next: string | null) => {
    const params = new URLSearchParams(search.toString());
    if (next) params.set("grain", next); else params.delete("grain");
    router.replace(`/objects/${object}?${params.toString()}`, { scroll: false });
  };

  const detailHref = `/objects/${object}/rules/${encodeURIComponent(rule.check_id)}?run=${run}`;
  const exportOptions = [{ format: "xlsx" as const, run: () => exportFindingRecords(run, rule.check_id, "xlsx") }];
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <Card
      title={rule.name ?? <Mono>{rule.check_id}</Mono>}
      actions={
        <>
          <ExportMenu options={exportOptions} />
          <Button variant="ghost" render={<Link href={detailHref}>Rule details</Link>} />
          {canApply ? <Button pending={draft.isPending} disabled={!data || data.records.length === 0} onClick={() => draft.mutate(null)}>Propose fix</Button> : null}
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="workbench-rule">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 m-text-meta m-ink-3">
          <span><span className="m-numeric m-text-stat m-ink">{rule.affected_count.toLocaleString()}</span> failing records</span>
          {rule.name ? <Mono>{rule.check_id}</Mono> : null}
          {rule.field ? <Mono>{rule.field}</Mono> : null}
          {rule.dimension ? <span>{formatModuleName(rule.dimension)}</span> : null}
          {isSeverity(rule.severity) ? <Status kind="severity" value={rule.severity} /> : null}
        </div>
        {grains.length > 1 ? <FilterChips label="Grain" value={grain} options={grains.map((g) => ({ value: g, label: g }))} onChange={setGrain} /> : null}
        {isLoading ? (
          <div aria-busy="true"><Skeleton height={240} /></div>
        ) : isError ? (
          <ErrorState {...apiErrorState(error)} onRetry={() => refetch()} />
        ) : !data || data.records.length === 0 ? (
          <EmptyState variant="inline" title="All records pass this rule" detail="Every record passed this check in this run." />
        ) : (
          <>
            <DataTable
              columns={columns}
              hideToolbar
              data={shown}
              getRowId={(row) => row.record_key}
              rowHref={(row) => fixSheetHref(object, run, row.record_key)}
              onRowClick={(row) => router.push(fixSheetHref(object, run, row.record_key))}
              bulkActions={canApply ? (selected) => (
                <Button variant="secondary" disabled={draft.isPending} onClick={() => draft.mutate(selected.map((r) => r.record_key))}>Add to fix batch</Button>
              ) : undefined}
            />
            <Pager page={page} pageCount={pageCount} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} />
          </>
        )}
      </div>
    </Card>
  );
}

export function Workbench({ object, run }: { object: string; run: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useQuery(objectQuery(object, run));
  const details = useRuleDetails(object, run);
  // The ranking names the rules it ranks; the catalogue (and the DDIC checks it does not hold) names the rest.
  const catalogueName = useRuleNames(data?.rules.filter((r) => r.affected_count > 0).map((r) => r.check_id) ?? []);

  if (isLoading) return <div aria-busy="true"><Skeleton height={320} /></div>;
  if (isError) return <ErrorState {...apiErrorState(error)} onRetry={() => refetch()} />;
  if (!data) return null;

  const dimension = search.get("dimension");
  const byId = new Map((details.data?.rows ?? []).map((r: RuleRow) => [r.check_id, r]));
  const failing: WorkRule[] = data.rules
    .filter((r) => r.affected_count > 0)
    .map((r) => ({ ...r, name: catalogueName(r.check_id) ?? rankedName(details.data?.rows, r.check_id) ?? null, field: byId.get(r.check_id)?.field ?? null, autoFixPct: byId.get(r.check_id)?.auto_fix_pct ?? null }))
    .sort((a, b) => b.affected_count - a.affected_count || (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4));
  const listed = failing.filter((r) => !dimension || r.dimension === dimension);
  const wanted = search.get("rule");
  // Without ?rule= the object's blocking rule is selected (it is what to fix first), else the worst rule.
  const selected =
    listed.find((r) => r.check_id === wanted)
    ?? listed.find((r) => r.check_id === data.blocking_rule_id)
    ?? listed.find((r) => r.severity === "critical")
    ?? listed[0];
  const top = failing[0]?.affected_count ?? 1;

  const hrefWith = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) params.set(k, v); else params.delete(k); }
    params.delete("grain");
    const q = params.toString();
    return q ? `/objects/${object}?${q}` : `/objects/${object}`;
  };
  const tabHref = (extra: string) => `/objects/${object}?run=${run}&tab=${extra}`;
  const rulesHref = tabHref("rules");
  const blockingRules = data.rules.filter((r) => isBlocking(r) && r.affected_count > 0).length;

  // Share of the failing records a fix can be proposed for automatically; the ranking says it per rule.
  const ranked = details.data?.rows ?? [];
  const autoRecords = ranked.length > 0
    ? Math.min(data.affected_records, Math.round(ranked.reduce((n, r) => n + r.affected * (r.auto_fix_pct / 100), 0)))
    : null;

  const dimensionItems = Object.entries(data.dimension_scores).map(([d, score]) => ({
    key: d,
    label: formatModuleName(d),
    score,
    href: hrefWith({ dimension: dimension === d ? null : d }),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="m-stat-grid">
        <Stat label="Failing rules" value={data.failing_checks.toLocaleString()} href={rulesHref} />
        {/* `?blocking=true` keeps the critical and high rules (isBlocking), not the blocking findings of the readiness view. */}
        <Stat label="Critical and high failing rules" value={blockingRules} tone={blockingRules > 0 ? "no-go" : "go"} href={`${rulesHref}&blocking=true`} />
        {/* Summed over the failing rules (a record failing two rules counts twice): rule failures, as the header says. */}
        <Stat label="Rule failures" value={data.affected_records.toLocaleString()} hint="records failing a rule, per rule" href={tabHref("fix")} />
        <Stat
          label="Auto-fixable"
          value={autoRecords == null ? "—" : autoRecords.toLocaleString()}
          hint={autoRecords != null && data.affected_records > 0 ? `${Math.round((autoRecords / data.affected_records) * 100)}% of rule failures` : undefined}
          href={autoRecords != null ? `/insights/rules?run=${run}&module=${object}&auto=yes` : undefined}
        />
      </div>
      <div className="grid [gap:var(--m-section-gap)] [grid-template-columns:minmax(0,1fr)] lg:[grid-auto-rows:min-content] lg:[grid-template-columns:400px_minmax(0,1fr)]" data-testid="workbench">
        <div className="min-w-0 lg:col-start-1">
          <Card title="Failing rules" meta={`${listed.length.toLocaleString()} of ${failing.length.toLocaleString()}`} padding="sm">
            {dimension && listed.length > 0 ? (
              <div className="px-3 pb-2">
                <Link href={hrefWith({ dimension: null })} replace scroll={false} className="m-choice">{formatModuleName(dimension)}, clear filter</Link>
              </div>
            ) : null}
            {failing.length === 0 ? (
              <EmptyState variant="inline" title="No rule fails" detail="Every rule passed for this object in this run." />
            ) : listed.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No rules match"
                detail="No failing rule fits the dimension filter."
                action={<Button variant="secondary" render={<Link href={hrefWith({ dimension: null })}>Clear filter</Link>} />}
              />
            ) : (
              <ul aria-label="Failing rules" className="flex flex-col lg:overflow-y-auto lg:[max-height:min(60vh,32rem)]">
                {listed.map((r) => (
                  <RankedRow
                    key={r.check_id}
                    tone={isSeverity(r.severity) ? r.severity : "low"}
                    href={hrefWith({ rule: r.check_id })}
                    replace
                    selected={r.check_id === selected?.check_id}
                    testId="workbench-rule-row"
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        {isSeverity(r.severity) ? <SeverityDot severity={r.severity} labelled /> : null}
                        <Mono>{r.check_id}</Mono>
                        {r.name ? <span className="min-w-0 flex-1 truncate font-normal m-ink-2">{r.name}</span> : null}
                      </span>
                    }
                    magnitude={r.affected_count.toLocaleString()}
                    share={(r.affected_count / top) * 100}
                    meta={r.field || r.dimension ? (
                      <>
                        {r.field ? <Mono>{r.field}</Mono> : null}
                        {r.dimension ? <span>{formatModuleName(r.dimension)}</span> : null}
                      </>
                    ) : undefined}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>
        {/* Below lg a picked rule (?rule=) opens as a sheet over the list; closing it drops the pick. */}
        <DetailPane
          open={!!wanted}
          onOpenChange={(o) => { if (!o) router.replace(hrefWith({ rule: null }), { scroll: false }); }}
          below={BELOW_LG}
          title={selected?.check_id ?? "Rule"}
          label="Selected rule"
          className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          {selected ? <RulePane key={selected.check_id} object={object} run={run} rule={selected} /> : null}
        </DetailPane>
        <div className="min-w-0 lg:col-start-1">
          <Card title="Score by dimension" padding="sm">
            {dimensionItems.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No dimension scores"
                detail="This run produced no per-dimension scores for this object."
                action={<Button render={<Link href={rulesHref}>Open rules</Link>} />}
              />
            ) : (
              <DimensionBars items={dimensionItems} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
