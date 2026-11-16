"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { exportExceptions, exportFixSheet, exportFixSheetByObject, importFixSheet, type ImportResult } from "@/lib/api/v2/work";
import type { WorkRow } from "@/lib/api/v2/types";
import type { WorkGroup } from "@/lib/api/work";
import { formatInt } from "@/lib/format";
import { useWaves } from "@/lib/v2/admin-queries";
import { batchLabel } from "@/lib/v2/batches";
import { useDensity, type Density } from "@/lib/v2/density";
import { hiddenColumns } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { refreshV2, useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { policyLabel } from "@/lib/v2/step10";
import { usePolicyPacks } from "@/lib/v2/step10-queries";
import { CHIPS, SORT_LABEL, type ChipId, STATUS_LABEL, exportQueryOf, filtersOf, ownerLabel, readState, viewFilters, withState, type LedgerState, type SortKey } from "@/lib/v2/work";
import { needsConfirm, useWorkActions, useWorkCan } from "@/lib/v2/work-actions";
import { allWorkRows, useWorkGroups, useWorkRows, useWorkSummary } from "@/lib/v2/work-queries";
import { Button, Chip, Code, Confirm, DataTable, DropZone, PartBar, SegmentedControl, Sparkline, useToast, type Column } from "../kit";
import { WorkBatches } from "./Batches";
import { WorkBulkBar } from "./BulkBar";
import { Banner, Consequence, FixHead, FlowSteps, MoreDetail } from "./parts";
import { WorkTools } from "./Tools";
import { useNativeWorkToast, useUndoKey } from "./undo";
import { workObjectHref } from "./Work";
import "./queue.css";
import "./work.css";

const SEVERITY_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" };
const rowId = (r: WorkRow) => `${r.module}|${r.record_key}|${r.version_id ?? ""}`;
const SORTS: SortKey[] = ["value", "due", "age", "owner"];
/** The states the rule grouping applies to (v2 Work GROUPABLE): rows still to fix. */
const GROUPABLE: ReadonlySet<ChipId | null> = new Set<ChipId | null>(["tofix", "proposed", null]);
type Group = WorkGroup;

function severityWord(s: string): string {
  switch (s) {
    case "critical": return t("Critical");
    case "high": return t("High");
    case "medium": return t("Medium");
    case "low": return t("Low");
    default: return t("Info");
  }
}

/**
 * The filtered work queue, natively: what a ?module=, ?rule=, ?filter=, ?batch= or saved-view address asks for. The
 * state lives in the address (lib/v2/work readState and withState), so every filter is a link. It carries the state
 * pills, the removable filter tags, the object and sort pickers, saved views, fix sheet export and import, the fix
 * batches with their approvals, and the per-record decisions of the bulk bar.
 */
export function WorkQueue() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const can = useWorkCan();
  const wt = useNativeWorkToast();
  const act = useWorkActions(wt);
  useUndoKey(wt.undoLast);
  const pathname = usePathname();
  const prefDensity = useDensity();
  const packs = usePolicyPacks().data?.packs;
  const waves = useWaves().data;
  const timeline = useTimeline(null, 8).data?.runs ?? [];
  const landscape = useLandscape(null).data;
  const search = params.toString();
  const state = useMemo(() => readState(new URLSearchParams(search)), [search]);
  const summary = useWorkSummary({ wave: state.wave ?? undefined, verdict: state.verdict ?? undefined }).data;
  const q = useWorkRows(filtersOf(state), state.sort);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const total = q.data?.pages[0]?.total;
  const byId = useMemo(() => new Map(rows.map((r) => [rowId(r), r])), [rows]);
  const [gen, setGen] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [imported, setImported] = useState<{ name: string; r: ImportResult } | null>(null);
  const [ask, setAsk] = useState<{ title: string; label: string; run: () => void } | null>(null);
  // A policy class or a past run is read by GET /work/records alone: the rule groups do not take them.
  const narrowed = Boolean(state.policy || state.asOf || state.since);
  const grouped = state.group && GROUPABLE.has(state.chip) && !narrowed;
  const groupWhy = narrowed ? t("Grouping by rule does not apply to a policy class or a past run") : GROUPABLE.has(state.chip) ? null : t("Grouping applies to rows to fix");
  const groupsQ = useWorkGroups({ module: state.module ?? undefined, severity: state.severity ?? undefined });
  const groups: Group[] = groupsQ.data?.groups ?? [];

  const go = (patch: Partial<LedgerState>, extra: Record<string, string | null> = {}) =>
    router.push(`/work?${withState(search, { ...state, ...patch }, { view: null, ...extra })}`);
  const clearAll = () => {
    const keep = new URLSearchParams();
    if (params.get("fixture")) keep.set("fixture", params.get("fixture") ?? "1");
    if (params.get("role")) keep.set("role", params.get("role") ?? "");
    router.push(`/work${keep.toString() ? `?${keep.toString()}` : ""}`);
  };

  const tags: { key: string; label: string; clear: () => void }[] = [];
  if (state.module) tags.push({ key: "module", label: moduleText(state.module), clear: () => go({ module: null }) });
  if (state.rule) tags.push({ key: "rule", label: t("Rule {rule}", { rule: state.rule }), clear: () => go({ rule: null }) });
  if (state.severity) tags.push({ key: "severity", label: t("Severity {severity}", { severity: state.severity }), clear: () => go({ severity: null }) });
  if (state.assigned) tags.push({ key: "assigned", label: state.assigned === "me" ? t("Assigned to me") : state.assigned === "unassigned" ? t("Unassigned") : t("Assigned"), clear: () => go({ assigned: null }) });
  if (state.batch) tags.push({ key: "batch", label: t("Batch {batchLabel}", { batchLabel: batchLabel(state.batch) }), clear: () => go({ batch: null }) });
  if (state.due) tags.push({ key: "due", label: state.due === "overdue" ? t("Overdue") : state.due === "week" ? t("Due this week") : t("Due soon"), clear: () => go({ due: null }) });
  if (state.policy) tags.push({ key: "policy", label: t("Policy: {label}", { label: policyLabel(state.policy, packs) }), clear: () => go({ policy: null }) });
  if (state.wave || state.verdict) tags.push({ key: "wave", label: summary?.wave?.name ?? (state.wave ? t("Wave {id}", { id: state.wave }) : t("Verdict {verdict}", { verdict: state.verdict ?? "" })), clear: () => go({ wave: null, verdict: null }) });
  if (state.system) tags.push({ key: "system", label: t("System {name}", { name: landscape?.systems.find((x) => x.id === state.system)?.name ?? (state.system === "upload" ? t("file uploads") : state.system) }), clear: () => go({ system: null }) });

  const pastRun = Boolean(state.asOf || state.version || state.since);
  const doExport = async (kind: "sheet" | "object" | "register") => {
    setBusy(kind);
    try {
      const f = exportQueryOf(state);
      const r = kind === "sheet" ? await exportFixSheet(f) : kind === "object" ? await exportFixSheetByObject(f) : await exportExceptions(f);
      toast({ text: kind === "register" ? t("Register saved as {filename}", { filename: r.filename }) : t("Fix sheet saved as {filename}", { filename: r.filename }), tone: "good" });
    } catch (e) {
      toast({ text: errorSentence(e, kind === "register" ? t("The register could not be exported.") : t("The fix sheet could not be exported.")), tone: "bad" });
    } finally {
      setBusy(null);
    }
  };
  // ?export=1 (a link from a report or the command palette) saves the fix sheet once, then drops the param.
  const exportedOnce = useRef(false);
  useEffect(() => {
    if (params.get("export") !== "1" || exportedOnce.current) return;
    exportedOnce.current = true;
    void doExport("sheet");
    const next = new URLSearchParams(search);
    next.delete("export");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per ?export=1 address
  }, [params, search, pathname]);
  const doImport = async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setBusy("import");
    try {
      const r = await importFixSheet(file);
      setImported({ name: file.name, r });
      await refreshV2(qc);
      setGen((g) => g + 1);
    } catch (e) {
      toast({ text: errorSentence(e, t("The file could not be read as a fix sheet.")), tone: "bad" });
    } finally {
      setBusy(null);
    }
  };
  const reopen = async (r: WorkRow) => {
    if (await act.decide([r], "reopen")) {
      toast({ text: t("Reopened"), tone: "good" });
      setGen((g) => g + 1);
    }
  };

  const cols: Column<WorkRow>[] = [
    {
      id: "record",
      label: t("Record"),
      cell: (r) => (
        <span className="nx-wk-rec">
          <Code code={r.record_key} />
          {r.name ? <span>{r.name}</span> : null}
          <small>{moduleText(r.module)}</small>
        </span>
      ),
    },
    {
      id: "rule",
      label: t("Rule"),
      cell: (r) => (
        <span className="nx-wk-rule">
          {r.checks[0] ? <Code code={r.checks[0]} /> : null}
          <span>{r.top_message ?? ""}</span>
        </span>
      ),
    },
    { id: "severity", label: t("Severity"), cell: (r) => <Chip tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{severityWord(r.severity)}</Chip> },
    { id: "state", label: t("State"), cell: (r) => <Chip tone={r.status === "fixed" ? "resolved" : "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Chip> },
    { id: "who", label: t("Who"), cell: (r) => ownerLabel(r) ?? t("Nobody yet") },
  ];
  const tools = cols.map((c) => ({ id: c.id, header: c.label, cell: c.cell }));
  const hidden = hiddenColumns("work-queue", tools);
  const columns: Column<WorkRow>[] = [
    ...cols.map((c) => ({ ...c, hidden: hidden.has(c.id) })),
    ...(state.chip === "exceptions" && can.apply
      ? [{ id: "reopen", label: t("Action"), cell: (r: WorkRow) => <Button variant="quiet" size={32} aria-label={t("Reopen {keyValue}", { keyValue: r.record_key })} onClick={() => void reopen(r)}>{t("Reopen")}</Button> }]
      : []),
  ];
  const skipped = imported?.r.skipped ?? [];

  // One action, chosen by the data: accept what is ready, else approve what waits, else start on the biggest rule.
  const confirmOr = (count: number, title: string, label: string, run: () => void) => (needsConfirm(count) ? setAsk({ title, label, run }) : run());
  const inScope = (g: Group) => (!state.module || g.module === state.module) && (!state.rule || g.check_id === state.rule);
  const topGroup = groups.find((g) => g.proposed > 0 && inScope(g));
  const topRule = groups.filter((g) => g.open > 0 && (!state.module || g.module === state.module)).sort((a, b) => b.open - a.open)[0];
  const waiting = CHIPS.find((c) => c.id === "approvals")?.count(summary, state.module) ?? 0;
  const acceptGroup = (g: Group, n: number) =>
    confirmOr(n, t("Accept {count} suggested values for {check}?", { count: int(n), check: g.check_id }), t("Accept {count} values", { count: int(n) }), () => {
      void act.acceptRule(g.check_id, n, g.version_id, rows).then(() => setGen((x) => x + 1));
    });
  const primary = pastRun ? null : can.apply && topGroup && state.chip !== "approvals" && state.chip !== "exceptions" ? (
    <Button variant="primary" onClick={() => acceptGroup(topGroup, topGroup.proposed)} data-testid="queue-primary">
      {t("Accept {count} suggested values on {check}", { count: int(topGroup.proposed), check: topGroup.check_id })}
    </Button>
  ) : can.approve && waiting > 0 && state.chip !== "approvals" ? (
    <Button variant="primary" onClick={() => go({ chip: "approvals", group: false })} data-testid="queue-primary">
      {t("Review the {waiting} waiting for approval", { waiting: int(waiting) })}
    </Button>
  ) : topRule && state.rule !== topRule.check_id ? (
    <Button variant="primary" onClick={() => go({ module: topRule.module, rule: topRule.check_id, group: false })} data-testid="queue-primary">
      {t("Start with the {n} records failing {check}", { n: int(topRule.open), check: topRule.check_id })}
    </Button>
  ) : null;
  const one = state.module ? (summary?.objects ?? []).find((o) => o.module === state.module) : undefined;
  const fig = state.module
    ? { open: one?.open ?? 0, critical: one?.critical ?? 0, proposed: one?.proposed ?? 0 }
    : { open: summary?.totals.open ?? 0, critical: summary?.totals.critical ?? 0, proposed: summary?.totals.proposed ?? 0 };
  const stepAt = state.chip === "approvals" ? 2 : state.chip === "approved" || state.chip === "sent" ? 3 : state.chip === "fixed" ? 4 : fig.proposed > 0 ? 1 : 0;
  const objectSpark = (module: string) => {
    const scores = timeline.map((r) => r.objects[module]?.score).filter((v): v is number => typeof v === "number");
    return <Sparkline points={scores} label={t("{name} score over the last {n} runs", { name: moduleText(module), n: scores.length })} />;
  };
  const sparkObjects = [...(summary?.objects ?? [])].filter((o) => o.open > 0 && (!state.module || o.module === state.module)).sort((a, b) => b.open - a.open).slice(0, 8);
  const density: Density = state.density ?? prefDensity;
  // GET /work/records does not send the batch of a row yet, so a ?batch= address cannot narrow the rows here.
  const batchUnfiltered = Boolean(state.batch) && rows.some((r) => r.batch_id === undefined);
  const groupCols: Column<Group>[] = [
    { id: "rule", label: t("Rule"), cell: (g) => <Code code={g.check_id} text={g.message ?? undefined} /> },
    { id: "object", label: t("Object"), cell: (g) => moduleText(g.module) },
    { id: "open", label: t("Open"), align: "end", cell: (g) => int(g.open), compare: (a, b) => a.open - b.open },
    { id: "proposed", label: t("Suggested"), align: "end", cell: (g) => int(g.proposed), compare: (a, b) => a.proposed - b.proposed },
    {
      id: "act",
      label: t("Action"),
      cell: (g) => (
        <span className="nx-wq-row">
          <Button variant="quiet" size={32} onClick={() => go({ module: g.module, rule: g.check_id, group: false })}>{t("Show records")}</Button>
          {can.apply && !pastRun && g.proposed > 0 ? <Button variant="secondary" size={32} onClick={() => acceptGroup(g, g.proposed)}>{t("Accept {count} values", { count: int(g.proposed) })}</Button> : null}
        </span>
      ),
    },
  ];

  return (
    <section className="nx-wq" aria-label={t("Work")} data-testid="work-queue">
      <Banner
        eyebrow={state.module ? moduleText(state.module) : t("Work")}
        headline={fig.open === 0 ? t("Nothing is open here") : t("{n} records need work", { n: int(fig.open) })}
        why={fig.proposed > 0 ? t("{n} already carry a suggested value to accept or edit.", { n: int(fig.proposed) }) : undefined}
        figs={[
          { label: t("Open"), value: int(fig.open) },
          { label: t("Critical"), value: int(fig.critical) },
          { label: t("Suggested"), value: int(fig.proposed) },
        ]}
        action={primary}
        testId="queue-banner"
        label={t("Work")}
      />
      <FixHead
        lede={t("Every record that fails a rule, with the value to fix it. Accept a suggested value, edit it, or send it for approval; nothing reaches SAP until it is approved and applied.")}
        means={[
          [t("Open"), t("Records that still fail at least one rule.")],
          [t("Critical"), t("Open records whose worst failure is critical.")],
          [t("Suggested"), t("Records with a machine-proposed value waiting for a decision.")],
        ]}
      />
      <FlowSteps
        label={t("Fixing steps")}
        current={stepAt}
        steps={[
          { label: t("Find what fails"), count: int(fig.open) },
          { label: t("Decide a value"), count: int(fig.proposed) },
          { label: t("Approve"), count: int(waiting) },
          { label: t("Send to SAP") },
          { label: t("Fixed") },
        ]}
      />
      <div className="nx-wk-pills" role="group" aria-label={t("State")}>
        {CHIPS.map((c) => (
          <Chip key={c.id} tone="neutral" pressed={state.chip === c.id} count={c.count(summary, state.module) ?? undefined} onClick={() => go({ chip: state.chip === c.id ? null : c.id })}>
            {c.label}
          </Chip>
        ))}
      </div>
      {tags.length ? (
        <div className="nx-wq-row" role="group" aria-label={t("Filters in force")}>
          {tags.map((tag) => (
            <Button key={tag.key} variant="quiet" size={32} aria-label={t("Remove filter: {label}", { label: tag.label })} onClick={tag.clear}>{tag.label}</Button>
          ))}
          <Button variant="quiet" size={32} onClick={clearAll}>{t("Clear filters")}</Button>
        </div>
      ) : null}
      <div className="nx-wq-bar">
        <label>{t("Object")}
          <select value={state.module ?? ""} onChange={(e) => go({ module: e.target.value || null })}>
            <option value="">{t("All objects")}</option>
            {(summary?.objects ?? []).map((o) => <option key={o.module} value={o.module}>{moduleText(o.module)}</option>)}
          </select>
        </label>
        <label>{t("Sort by")}
          <select value={state.sort} onChange={(e) => go({ sort: e.target.value as SortKey })}>
            {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
        </label>
        {(waves ?? []).length ? (
          <label>{t("Wave")}
            <select value={state.wave ?? ""} onChange={(e) => go({ wave: e.target.value || null })}>
              <option value="">{t("All waves")}</option>
              {(waves ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        ) : null}
        <SegmentedControl<"flat" | "rule">
          label={t("Group the list")}
          items={[{ value: "flat", label: t("Flat") }, { value: "rule", label: t("By rule") }]}
          value={grouped ? "rule" : "flat"}
          onChange={(v) => (v === "rule" && groupWhy ? toast({ text: groupWhy, tone: "neutral" }) : go({ group: v === "rule" }))}
        />
        <SegmentedControl<Density>
          label={t("Row density")}
          items={[{ value: "compact", label: t("Compact") }, { value: "comfortable", label: t("Comfortable") }]}
          value={density}
          onChange={(v) => go({ density: v })}
        />
        <Button variant="secondary" size={32} disabled={pastRun || busy !== null} loading={busy === "sheet"} onClick={() => void doExport("sheet")}>{t("Export fix sheet")}</Button>
        <Button variant="quiet" size={32} disabled={pastRun || busy !== null} loading={busy === "object"} onClick={() => void doExport("object")}>{t("Export by object")}</Button>
        {state.chip === "exceptions" && session.can("export") ? (
          <Button variant="quiet" size={32} disabled={pastRun || busy !== null} loading={busy === "register"} onClick={() => void doExport("register")}>{t("Export register")}</Button>
        ) : null}
      </div>
      {groupWhy && state.group ? <p className="nx-wq-meta" data-testid="group-why">{groupWhy}</p> : null}
      <WorkTools gridId="work-queue" route="work" title={t("Work")} columns={tools} rows={rows} filters={viewFilters(state)} allRows={() => allWorkRows(filtersOf(state), state.sort)} onColumns={() => setGen((g) => g + 1)} />
      {can.apply && !pastRun ? (
        <DropZone label={t("Choose a filled fix sheet")} hint={t("Drop the filled fix sheet here, or choose a file (.xlsx or .csv). Meridian checks keys, SAP fields and values before anything changes.")} accept=".xlsx,.csv" busy={busy === "import"} onFiles={(f) => void doImport(f)} />
      ) : null}
      {imported ? (
        <div className="nx-wq-card" role="status" data-testid="import-result">
          <p>
            {t("{name}: {updated} {updated2, plural, one {decision} other {decisions}} saved from {rows} {rows2, plural, one {row} other {rows}}{value}.", {
              name: imported.name,
              updated: int(imported.r.updated),
              updated2: imported.r.updated,
              rows: int(imported.r.rows),
              rows2: imported.r.rows,
              value: skipped.length ? t("; {skippedCount} skipped", { skippedCount: int(skipped.length) }) : "",
            })}
          </p>
          {skipped.length ? (
            <ul>
              {skipped.slice(0, 5).map((s) => <li key={s}>{s}</li>)}
              {skipped.length > 5 ? <li>{t("and {count} more", { count: int(skipped.length - 5) })}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <WorkBatches state={state} onShow={(id) => go({ chip: null, batch: id, group: false })} onOpen={(id) => go({}, { open: `batch:${id}` })} />
      {batchUnfiltered ? (
        <p className="nx-wq-card" role="status" data-testid="batch-unfiltered">{t("This list is not narrowed to the batch yet: the API does not send the batch of a row. The batch inspector lists its records.")}</p>
      ) : null}
      <Consequence>{t("Accepting or editing a value only proposes it. Nothing reaches SAP until it is approved and applied.")}</Consequence>
      <p className="nx-wq-meta" aria-live="polite">{total != null ? `${formatInt(total)} ${t("{n, plural, one {record} other {records}}", { n: total })}` : ""}</p>
      {grouped ? (
        <DataTable<Group>
          key={`g-${search}-${gen}`}
          rows={groups.filter((g) => g.open > 0 && inScope(g))}
          columns={groupCols}
          rowKey={(g) => `${g.module}|${g.check_id}`}
          rowLabel={(g) => `${g.check_id} ${g.message ?? ""}`.trim()}
          caption={t("Rules with records to fix")}
          density={density}
          loading={groupsQ.isPending}
          error={groupsQ.isError ? { sentence: t("The rule groups could not be loaded."), onRetry: () => void groupsQ.refetch() } : undefined}
          empty={{ heading: t("No rule has records to fix here.") }}
        />
      ) : (
      <DataTable<WorkRow>
        key={`${search}-${gen}`}
        density={density}
        rows={rows}
        columns={columns}
        rowKey={rowId}
        rowLabel={(r) => `${r.record_key} ${r.name ?? ""}`.trim()}
        caption={t("Records that need work")}
        total={total}
        selectable={!pastRun}
        bulkActions={(keys) => <WorkBulkBar rows={keys.map((k) => byId.get(k)).filter((r): r is WorkRow => !!r)} onDone={() => setGen((g) => g + 1)} />}
        onOpenRow={(r) => {
          const href = workObjectHref(r, landscape);
          if (href) router.push(href);
        }}
        loading={q.isPending}
        error={q.isError ? { sentence: t("The records could not be loaded."), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("Nothing here"), text: t("No record is in this state right now."), action: <Button variant="secondary" onClick={clearAll}>{t("Clear filters")}</Button> }}
      />
      )}
      {!grouped && q.hasNextPage ? (
        <div className="nx-wk-more">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("Show more")}</Button>
        </div>
      ) : null}
      {sparkObjects.length ? (
        <MoreDetail title={t("Where the work is")}>
          {state.module ? (
            <PartBar
              label={t("Open records by rule")}
              format={int}
              segments={groups.filter((g) => g.open > 0 && g.module === state.module).sort((a, b) => b.open - a.open).slice(0, 6).map((g) => ({ label: `${g.check_id} ${g.message ?? ""}`.trim(), value: g.open }))}
            />
          ) : (
            <PartBar label={t("Open records by object")} format={int} segments={sparkObjects.map((o) => ({ label: moduleText(o.module), value: o.open }))} />
          )}
          <ul className="nx-wp-sparks" data-testid="object-sparks">
            {sparkObjects.map((o) => (
              <li key={o.module}><span>{moduleText(o.module)}</span>{objectSpark(o.module)}</li>
            ))}
          </ul>
        </MoreDetail>
      ) : null}
      <Confirm
        open={ask !== null}
        title={ask?.title ?? ""}
        consequence={t("Accepting only proposes the values. Nothing reaches SAP until it is approved and applied.")}
        confirmLabel={ask?.label ?? ""}
        onConfirm={() => { ask?.run(); setAsk(null); }}
        onCancel={() => setAsk(null)}
      />
    </section>
  );
}
