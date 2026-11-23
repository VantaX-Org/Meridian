"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/v2/i18n";
import type { WorkRow } from "@/lib/api/v2/types";
import { displayKey, STATUS_LABEL, type LedgerState } from "@/lib/v2/work";
import { useGridState } from "@/ui/kit/useGridState";
import { Button, DataTable, ProposalChip, useStacked, Sheet, type Column, type RejectReason } from "@/ui/kit";
import { score as fmt } from "@/ui/screens/object/format";
import { fieldText } from "../shared";
import { RecordDetail } from "../RecordDetail";
import { isDraft, machineValue, rowId } from "./fixlib";
import { useProjection } from "./ScoreStrip";
import type { FixVars } from "./useFixData";

const reasons = (): RejectReason[] => [
  { id: "wrong", label: t("The proposed value is wrong") },
  { id: "correct", label: t("The current value is correct") },
  { id: "person", label: t("A person must check this") },
  { id: "other", label: t("Another reason") },
];

const currentText = (r: WorkRow): string => r.current_label ?? r.current_value ?? "";
const conf = (r: WorkRow): string => (r.suggestion?.confidence === "high" ? t("High") : r.suggestion?.confidence === "medium" ? t("Medium") : "-");
const source = (r: WorkRow): string =>
  r.suggestion?.source === "rule" ? t("Rule") : r.suggestion?.source === "value_map" ? t("Value map") : r.suggestion?.source === "cleaning" ? t("Cleaning") : "-";

/** The rows that A and Shift+A may accept: open, with a value the engine proposes. */
export const acceptable = (rows: WorkRow[]): WorkRow[] => rows.filter((r) => r.status === "to_fix" && machineValue(r) !== null);

/**
 * The record grid. A accepts, R rejects with a reason, E edits the proposed value in the cell, X selects, Shift+A opens the
 * apply-all preview. Keys act on the selected rows, or on the active row when none is selected.
 */
export function FixGrid({ rows, state, module, drafts, fullRules, decide, hasMore, loadingMore, onMore, loading }: {
  rows: WorkRow[]; state: LedgerState; module: string | null; drafts: WorkRow[]; fullRules: string[];
  decide: (v: FixVars) => void; hasMore: boolean; loadingMore: boolean; onMore: () => void; loading?: boolean;
}) {
  const grid = useGridState("fix");
  const stacked = useStacked();
  const wrap = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<WorkRow[] | null>(null);
  const [preview, setPreview] = useState<WorkRow[] | null>(null);
  const byId = useMemo(() => new Map(rows.map((r) => [rowId(r), r])), [rows]);
  const open = grid.open ? byId.get(grid.open) ?? null : null;

  const activeRow = useCallback((): WorkRow | null => {
    const id = wrap.current?.querySelector(".mx-table")?.getAttribute("aria-activedescendant") ?? "";
    return byId.get(id.replace(/^mx-row-/, "")) ?? null;
  }, [byId]);
  const targets = useCallback((): WorkRow[] => {
    const picked = selected.map((k) => byId.get(k)).filter((r): r is WorkRow => !!r);
    if (picked.length) return picked;
    const a = activeRow();
    return a ? [a] : [];
  }, [selected, byId, activeRow]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.closest(".mx-proposal")) return;
    const k = e.key.toLowerCase();
    if (k === "a" && e.shiftKey) {
      e.preventDefault();
      const all = acceptable(rows);
      if (all.length) setPreview(all);
    } else if (k === "a") {
      e.preventDefault();
      const todo = acceptable(targets());
      if (todo.length) decide({ action: "accept", rows: todo });
    } else if (k === "r") {
      e.preventDefault();
      const todo = targets().filter((r) => r.status === "to_fix");
      if (todo.length) setRejecting(todo);
    } else if (k === "e") {
      e.preventDefault();
      wrap.current?.querySelector(".mx-table")?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
    } else if (k === "x") {
      e.preventDefault();
      const a = activeRow();
      if (a) setSelected((s) => (s.includes(rowId(a)) ? s.filter((x) => x !== rowId(a)) : [...s, rowId(a)]));
    }
  };

  const columns: Column<WorkRow>[] = [
    {
      key: "record", label: t("Record"), width: 220, sort: (r) => displayKey(r.record_key),
      render: (r) => <span className="mx-fix-rec"><span className="mx-code">{displayKey(r.record_key)}</span><span className="mx-muted">{r.name}</span></span>,
    },
    {
      key: "field", label: t("Field"), width: 200, groupable: true, value: (r) => r.top_field ?? "",
      render: (r) => <span className="mx-fix-field"><span className="mx-code">{r.top_field ?? ""}</span><span className="mx-muted">{fieldText(r.top_field, r.field_description)}</span></span>,
    },
    {
      key: "current", label: t("Current value"), width: 160, value: currentText,
      render: (r) => (currentText(r) ? <span className="mx-num">{currentText(r)}</span> : <span className="mx-muted">{t("Loads on open")}</span>),
    },
    {
      key: "proposed", label: t("New value"), width: 340, value: (r) => r.new_value ?? machineValue(r) ?? "",
      edit: { value: (r) => r.new_value ?? machineValue(r) ?? "", label: t("New value"), onCommit: (r, v) => decide({ action: "edit", rows: [r], value: v }) },
      render: (r) => {
        if (isDraft(r)) return <span className="mx-fix-draft" data-testid="draft-value"><span className="mx-num">{r.new_value ?? ""}</span></span>;
        const m = machineValue(r);
        if (r.status !== "to_fix" || m === null) return <span className="mx-muted">{r.status === "to_fix" ? t("Needs a person") : "-"}</span>;
        return (
          <ProposalChip
            current={currentText(r) || "-"} proposed={m} reasons={reasons()}
            evidence={r.suggestion ? { source: source(r), reason: r.suggestion.why } : undefined}
            onAccept={() => decide({ action: "accept", rows: [r] })}
            onReject={(id) => decide({ action: "reject", rows: [r], reason: reasons().find((x) => x.id === id) })}
            onEdit={() => wrap.current?.querySelector(".mx-table")?.dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }))}
          />
        );
      },
    },
    { key: "source", label: t("Source"), width: 110, value: source, render: source },
    { key: "confidence", label: t("Confidence"), width: 110, value: conf, render: conf },
    { key: "status", label: t("Status"), width: 150, groupable: true, value: (r) => STATUS_LABEL[r.status] ?? r.status, render: (r) => STATUS_LABEL[r.status] ?? r.status },
  ];

  const filtered = Object.values(grid.filters).some((v) => v.length > 0) || grid.groupBy;
  return (
    <div className="mx-fixgrid" data-open={open ? "" : undefined}>
      <div ref={wrap} onKeyDown={onKeyDown} className="mx-fixgrid-main" data-testid="fix-grid">
        <DataTable
          id="fix" label={t("Fixes")} columns={columns} rows={rows} rowKey={rowId} height={520}
          grid={grid} selection="multi" selectedKeys={selected} onSelectedKeys={setSelected}
          selected={grid.open} onSelect={(r) => grid.setOpen(rowId(r))}
          bulkActions={[
            { id: "accept", label: t("Accept"), run: (keys) => { const todo = acceptable(keys.map((k) => byId.get(k)).filter((r): r is WorkRow => !!r)); if (todo.length) decide({ action: "accept", rows: todo }); } },
            { id: "reject", label: t("Reject"), danger: true, run: (keys) => setRejecting(keys.map((k) => byId.get(k)).filter((r): r is WorkRow => !!r && r.status === "to_fix")) },
          ]}
        />
        <p className="mx-fix-foot mx-muted">
          <span data-testid="loaded-note">{t("{n, plural, one {# record loaded} other {# records loaded}}", { n: rows.length })}</span>
          {filtered ? <span>{" "}{t("Grouped and filtered within the loaded {n} rows", { n: rows.length })}</span> : null}
          {hasMore ? <Button variant="ghost" disabled={loadingMore} onClick={onMore}>{t("Load more")}</Button> : null}
          <span className="mx-fix-keys"><kbd className="mx-kbd">A</kbd> {t("Accept")} <kbd className="mx-kbd">R</kbd> {t("Reject")} <kbd className="mx-kbd">E</kbd> {t("Edit")} <kbd className="mx-kbd">X</kbd> {t("Select")} <kbd className="mx-kbd">Shift+A</kbd> {t("Accept all")}</span>
        </p>
      </div>
      {open && !stacked ? <aside className="mx-fixgrid-side" aria-label={t("Record")}><RecordDetail module={open.module} recordKey={open.record_key} version={open.version_id} /></aside> : null}
      {open && stacked ? <Sheet open onClose={() => grid.setOpen(null)} label={t("Record")} closeLabel={t("Close")}><RecordDetail module={open.module} recordKey={open.record_key} version={open.version_id} /></Sheet> : null}
      {loading ? null : null}
      <RejectDialog rows={rejecting} onCancel={() => setRejecting(null)} onPick={(reason) => { if (rejecting) decide({ action: "reject", rows: rejecting, reason }); setRejecting(null); setSelected([]); }} />
      {preview ? (
        <ApplyAll
          rows={preview} module={module} drafts={drafts} fullRules={fullRules} state={state}
          onCancel={() => setPreview(null)}
          onConfirm={() => { decide({ action: "accept", rows: preview }); setPreview(null); setSelected([]); }}
        />
      ) : null}
    </div>
  );
}

/** Why a fix is rejected: one button per reason, Escape cancels. */
function RejectDialog({ rows, onCancel, onPick }: { rows: WorkRow[] | null; onCancel: () => void; onPick: (r: RejectReason) => void }) {
  useEffect(() => {
    if (!rows) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [rows, onCancel]);
  if (!rows) return null;
  const title = t("{n, plural, one {Why reject this fix?} other {Why reject these # fixes?}}", { n: rows.length });
  return (
    <div className="mx-scrim" data-place="center" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="mx-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid="reject-dialog">
        <h2 className="mx-dialog-h">{title}</h2>
        <ul className="mx-fix-reasons">
          {reasons().map((r, i) => <li key={r.id}><button type="button" className="mx-btn" data-variant="ghost" autoFocus={i === 0} onClick={() => onPick(r)}>{r.label}</button></li>)}
        </ul>
        <div className="mx-dialog-f"><button type="button" className="mx-btn" onClick={onCancel}>{t("Cancel")}</button></div>
      </div>
    </div>
  );
}

/** Apply every open proposal in view: the count, the rule and the projected score, then Enter confirms and Escape cancels. */
function ApplyAll({ rows, module, drafts, fullRules, state, onCancel, onConfirm }: {
  rows: WorkRow[]; module: string | null; drafts: WorkRow[]; fullRules: string[]; state: LedgerState; onCancel: () => void; onConfirm: () => void;
}) {
  const { res } = useProjection(module, useMemo(() => [...drafts, ...rows], [drafts, rows]), fullRules);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus(); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onCancel]);
  const rule = state.rule ? state.rule.split(",").join(", ") : t("All rules in view");
  return (
    <div className="mx-fixpreview" role="alertdialog" aria-label={t("{n, plural, one {Apply # proposal} other {Apply all # proposals}}", { n: rows.length })} data-testid="apply-preview">
      <span><b>{t("{n, plural, one {Apply # proposal} other {Apply all # proposals}}", { n: rows.length })}</b> {rule}</span>
      <span className="mx-muted">{res?.after && res.after.score !== null ? t("Projected score {n}", { n: fmt(res.after.score) }) : t("The projected score is loading")}</span>
      <span className="mx-fixpreview-act">
        <button type="button" className="mx-btn" onClick={onCancel}>{t("Cancel")}</button>
        <button ref={ok} type="button" className="mx-btn" data-variant="primary" onClick={onConfirm} data-testid="apply-confirm">{t("Apply")}</button>
      </span>
    </div>
  );
}
