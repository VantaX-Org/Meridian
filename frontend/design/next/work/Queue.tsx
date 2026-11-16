"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { exportExceptions, exportFixSheet, exportFixSheetByObject, importFixSheet, type ImportResult } from "@/lib/api/v2/work";
import type { WorkRow } from "@/lib/api/v2/types";
import { formatInt } from "@/lib/format";
import { batchLabel } from "@/lib/v2/batches";
import { hiddenColumns } from "@/lib/v2/grid-export";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { refreshV2, useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { CHIPS, SORT_LABEL, STATUS_LABEL, exportQueryOf, filtersOf, ownerLabel, readState, viewFilters, withState, type LedgerState, type SortKey } from "@/lib/v2/work";
import { useWorkActions, useWorkCan } from "@/lib/v2/work-actions";
import { allWorkRows, useWorkRows, useWorkSummary } from "@/lib/v2/work-queries";
import { Button, Chip, Code, DataTable, DropZone, useToast, type Column } from "../kit";
import { WorkBatches } from "./Batches";
import { WorkBulkBar } from "./BulkBar";
import { WorkTools } from "./Tools";
import { workObjectHref } from "./Work";
import "./queue.css";
import "./work.css";

const SEVERITY_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" };
const rowId = (r: WorkRow) => `${r.module}|${r.record_key}|${r.version_id ?? ""}`;
const SORTS: SortKey[] = ["value", "due", "age", "owner"];

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
  const act = useWorkActions();
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
  // ponytail: raw policy value; the v2 label lookup needs the rule packs, add policyLabel when this screen reads them.
  if (state.policy) tags.push({ key: "policy", label: t("Policy: {label}", { label: state.policy }), clear: () => go({ policy: null }) });
  if (state.wave || state.verdict) tags.push({ key: "wave", label: summary?.wave?.name ?? (state.wave ? t("Wave {id}", { id: state.wave }) : t("Verdict {verdict}", { verdict: state.verdict ?? "" })), clear: () => go({ wave: null, verdict: null }) });
  if (state.system) tags.push({ key: "system", label: t("System {name}", { name: landscape?.systems.find((x) => x.id === state.system)?.name ?? (state.system === "upload" ? t("file uploads") : state.system) }), clear: () => go({ system: null }) });

  const pastRun = Boolean(state.asOf || state.version);
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

  return (
    <section className="nx-wq" aria-label={t("Work")} data-testid="work-queue">
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
        <Button variant="secondary" size={32} disabled={pastRun || busy !== null} loading={busy === "sheet"} onClick={() => void doExport("sheet")}>{t("Export fix sheet")}</Button>
        <Button variant="quiet" size={32} disabled={pastRun || busy !== null} loading={busy === "object"} onClick={() => void doExport("object")}>{t("Export by object")}</Button>
        {state.chip === "exceptions" && session.can("export") ? (
          <Button variant="quiet" size={32} disabled={pastRun || busy !== null} loading={busy === "register"} onClick={() => void doExport("register")}>{t("Export register")}</Button>
        ) : null}
      </div>
      <WorkTools gridId="work-queue" route="work" title={t("Work")} columns={tools} rows={rows} filters={viewFilters(state)} allRows={() => allWorkRows(filtersOf(state), state.sort)} onColumns={() => setGen((g) => g + 1)} />
      {can.apply && !pastRun ? (
        <DropZone label={t("Choose a filled fix sheet")} hint={t("Drop the filled fix sheet here, or choose a file (.xlsx). Meridian checks keys, SAP fields and values before anything changes.")} accept=".xlsx" busy={busy === "import"} onFiles={(f) => void doImport(f)} />
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
      <p className="nx-wq-meta" aria-live="polite">{total != null ? `${formatInt(total)} ${t("{n, plural, one {record} other {records}}", { n: total })}` : ""}</p>
      <DataTable<WorkRow>
        key={`${search}-${gen}`}
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
      {q.hasNextPage ? (
        <div className="nx-wk-more">
          <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("Show more")}</Button>
        </div>
      ) : null}
    </section>
  );
}
