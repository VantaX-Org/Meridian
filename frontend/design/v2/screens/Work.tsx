"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkGroup } from "@/lib/api/work";
import type { WorkRow } from "@/lib/api/v2/types";
import { errorSentence, exportFixSheet, importFixSheet, type ImportResult } from "@/lib/api/v2/work";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { ledgerRegistry, type LedgerTarget } from "@/lib/v2/keys";
import { refreshV2, useLandscape, useStatus } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import {
  CHIPS,
  STATUS_LABEL,
  SORT_LABEL,
  SORTS_LOADED_ROWS,
  chipDef,
  compareRows,
  daysOpen,
  filtersOf,
  initials,
  keyHeaders,
  readState,
  recordItemId,
  sentence,
  type ChipId,
  type Density,
  type LedgerState,
  type SortKey,
  viewFilters,
  withState,
  MANAGED,
} from "@/lib/v2/work";
import { useWorkActions, useWorkCan, type DecideKind } from "@/lib/v2/work-actions";
import { patched, usePatches } from "@/lib/v2/work-overrides";
import { PAGE, useGroupRows, useWorkGroups, useWorkRows, useWorkSummary, useWorkViews } from "@/lib/v2/work-queries";
import { Grid, type GridColumn, type GridHandle } from "../Grid";
import { IconChevron, IconClose, SeverityMark } from "../marks";
import { MenuButton, type MenuEntry } from "../Menu";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, PageTitle, V2Link } from "../parts";
import { usePhone } from "@/lib/v2/hooks";
import { useToast } from "../Toast";
import "../approvals.css";
import { BatchButtons, day, money, useBatchControls } from "./batch-parts";
import { ResultFrame } from "../inspector/shared";
import type { Outcome } from "../inspector/shared";
import { BATCH_STATUS_LABEL, batchLabel, groupByBatch, sentLine, type BatchRow } from "@/lib/v2/batches";
import { useBatches } from "@/lib/v2/approvals-queries";
import { BulkActions, CurrentValue, DecisionCell, NewValueCell, OwnerCell, PossibleValuesCell, PromptDialog, keyValue, rowKeyOf, type LedgerHandlers } from "./work-parts";
import { GridTools, useGridKey } from "../GridTools";
import { FixOrderHint } from "./object/Related";

// The rows of the grid: records, and in "By rule" the rule headings and a "show more" line under each.
type Item =
  | { kind: "row"; row: WorkRow }
  | { kind: "group"; group: WorkGroup; open: boolean }
  | { kind: "more"; check: string; shown: number; total: number }
  | { kind: "batch"; batch: BatchRow };

const itemId = (it: Item): string => (it.kind === "row" ? recordItemId(it.row) : it.kind === "group" ? `g:${it.group.check_id}` : it.kind === "batch" ? `b:${it.batch.id}` : `m:${it.check}`);
const GROUP_ROWS = 25;
const COLUMNS_ID = "work-ledger";
const GROUPABLE: ReadonlySet<ChipId | null> = new Set<ChipId | null>(["tofix", "proposed", null]);
const OPEN_STATUSES = new Set(["to_fix", "proposed", "approved", "sent"]);

/** After a change, which rows still belong to the list the chip asks for. */
function belongs(row: WorkRow, chip: ChipId | null, batch: string | null = null): boolean {
  if (batch && row.batch_id !== undefined && row.batch_id !== batch) return false;
  if (chip === null) return OPEN_STATUSES.has(row.status);
  const c = chipDef(chip);
  return row.status === c.status;
}

const objectName = (module: string, labels: Map<string, string>) => labels.get(module) ?? module.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Chips({ state, counts, set, groupRef }: { state: LedgerState; counts: Map<ChipId, number | null>; set: (chip: ChipId | null) => void; groupRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="m2-chips" role="group" aria-label="Filter by state" ref={groupRef}>
      {CHIPS.map((c) => {
        const n = counts.get(c.id);
        return (
          <button key={c.id} type="button" className="m2-chip" aria-pressed={state.chip === c.id} onClick={() => set(state.chip === c.id ? null : c.id)}>
            {c.label} <span className="m2-chip-n">{n == null ? "—" : int(n)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The ledger: every record and failing field, one row each, ranked by value at risk. The row is the fix. */
export function WorkCanvas() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const phone = usePhone();
  const { openItem, open } = useOpenItem();
  const patches = usePatches();
  const actions = useWorkActions();

  const search = params.toString();
  const viewId = params.get("view");
  const viewsQ = useWorkViews();
  const view = viewId ? viewsQ.data?.views.find((v) => v.id === viewId) : undefined;
  const viewPending = Boolean(viewId) && viewsQ.isPending;
  const state = useMemo(() => readState(new URLSearchParams(search), view), [search, view]);
  const filters = useMemo(() => filtersOf(state), [state]);

  const summaryQ = useWorkSummary();
  const landscape = useLandscape(null).data;
  const status = useStatus().data;
  const labels = useMemo(() => new Map((landscape?.objects ?? []).map((o) => [o.module, o.label] as const)), [landscape]);
  const summary = summaryQ.data;
  const counts = useMemo(() => new Map(CHIPS.map((c) => [c.id, c.count(summary, state.module)] as const)), [summary, state.module]);

  const batchesQ = useBatches(state.chip === "approvals" || Boolean(state.batch));
  const [sent, setSent] = useState<Outcome | null>(null);
  const controls = useBatchControls(setSent);
  const wc = useWorkCan();
  const can = useMemo(() => ({ apply: wc.apply, approve: wc.approve, assign: wc.assign }), [wc.apply, wc.approve, wc.assign]);
  const grouped = state.group && GROUPABLE.has(state.chip);
  const groupsQ = useWorkGroups({ module: state.module ?? undefined, severity: state.severity ?? undefined }, true);
  const rowsQ = useWorkRows(filters, state.sort, !grouped && !viewPending);

  // "By rule": the first rule opens by itself; each open rule loads its first rows.
  const groups = useMemo(() => {
    const all = groupsQ.data?.groups ?? [];
    return all.filter((g) => (!state.rule || g.check_id === state.rule) && (state.chip !== "proposed" || g.proposed > 0));
  }, [groupsQ.data, state.rule, state.chip]);
  const [expanded, setExpanded] = useState<Record<string, number> | null>(null);
  const openGroups = useMemo(() => expanded ?? (groups[0] ? { [groups[0].check_id]: GROUP_ROWS } : {}), [expanded, groups]);
  const groupFilters = useMemo(() => ({ ...filters, check_id: undefined }), [filters]);
  const openChecks = useMemo(() => Object.entries(openGroups).map(([check, limit]) => ({ check, limit })), [openGroups]);
  const groupRowsQ = useGroupRows(groupFilters, grouped ? openChecks : [], state.sort);

  const compare = useMemo(() => compareRows(state.sort), [state.sort]);
  const visible = useCallback(
    (rows: readonly WorkRow[]) =>
      rows
        .map((r) => patched(r, patches))
        .filter((r) => belongs(r, state.chip, state.batch))
        .sort(compare),
    [patches, state.chip, state.batch, compare],
  );

  const flatRows = useMemo(() => (grouped ? [] : visible((rowsQ.data?.pages ?? []).flatMap((p) => p.items))), [grouped, rowsQ.data, visible]);
  const items = useMemo<Item[]>(() => {
    if (!grouped && state.chip === "approvals") {
      // Records in draft batches, under their batch; then the batches that have moved on (approved, sent), as headings.
      const drafts = batchesQ.rows.filter((b) => b.status === "draft");
      const { groups: under, loose } = groupByBatch(drafts, flatRows);
      const out: Item[] = [];
      for (const g of under) {
        out.push({ kind: "batch", batch: g.batch });
        g.rows.forEach((row) => out.push({ kind: "row", row }));
      }
      loose.forEach((row) => out.push({ kind: "row", row }));
      if (!state.rule && !state.module) {
        batchesQ.rows.filter((b) => b.status === "approved").forEach((batch) => out.push({ kind: "batch", batch }));
        batchesQ.rows.filter((b) => b.status === "exported").sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")).slice(0, 5).forEach((batch) => out.push({ kind: "batch", batch }));
      }
      return out;
    }
    if (!grouped && state.batch) {
      const one = batchesQ.rows.find((b) => b.id === state.batch);
      return [...(one ? [{ kind: "batch", batch: one } as Item] : []), ...flatRows.map((row) => ({ kind: "row", row }) as Item)];
    }
    if (!grouped) return flatRows.map((row) => ({ kind: "row", row }));
    const out: Item[] = [];
    groups.forEach((g) => {
      const idx = openChecks.findIndex((c) => c.check === g.check_id);
      out.push({ kind: "group", group: g, open: idx >= 0 });
      if (idx < 0) return;
      const page = groupRowsQ[idx]?.data;
      const rows = visible(page?.items ?? []);
      rows.forEach((row) => out.push({ kind: "row", row }));
      const total = page?.total ?? rows.length;
      if (page && total > rows.length) out.push({ kind: "more", check: g.check_id, shown: rows.length, total });
    });
    return out;
  }, [grouped, flatRows, groups, openChecks, groupRowsQ, visible, state.chip, state.batch, state.rule, state.module, batchesQ.rows]);
  const recordRows = useMemo(() => items.flatMap((it) => (it.kind === "row" ? [it.row] : [])), [items]);

  // Refs the keyboard and the cells read when an event fires.
  const selected = useRef<WorkRow[]>([]);
  const active = useRef<WorkRow | undefined>(undefined);
  const recordRowsRef = useRef(recordRows);
  useEffect(() => {
    recordRowsRef.current = recordRows;
  });
  const [drafts] = useState(() => new Map<string, string>());
  const [reason, setReason] = useState<{ rows: WorkRow[]; kind: "not_an_issue" | "accept_risk"; clear?: () => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [imp, setImp] = useState<{ name: string; busy: boolean; result?: ImportResult; error?: string } | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const gridHandle = useRef<GridHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const go = useCallback(
    (patch: Partial<LedgerState>) => {
      const qs = withState(search, { ...state, ...patch }, { view: null });
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search, state],
  );

  const targets = useCallback((): WorkRow[] => {
    if (selected.current.length) return selected.current;
    return active.current ? [active.current] : [];
  }, []);

  const h = useMemo<LedgerHandlers>(
    () => ({
      can,
      drafts,
      commit: (row, value) => {
        drafts.delete(rowKeyOf(row));
        void actions.decide([row], "edit", { value });
      },
      decide: (rows, kind: DecideKind) => {
        if (kind === "not_an_issue" || kind === "accept_risk") setReason({ rows: [...rows] as WorkRow[], kind });
        else void actions.decide(rows, kind);
      },
      assign: (rows, assignee) => void actions.decide(rows, "assign", { assignee }),
      setValueFor: (rows, value) => actions.decide(rows, "edit", { value }),
      fillDown: (from, value) => {
        const sel = selected.current;
        if (sel.length === 0) {
          toast.show("Select the rows to fill, then press ⌘D in the New value you want to copy.");
          return;
        }
        const rows = sel.some((r) => rowKeyOf(r) === rowKeyOf(from)) ? sel : [from, ...sel];
        drafts.delete(rowKeyOf(from));
        void actions.decide(rows, "edit", { value, label: `Filled ${value} down ${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "row" : "rows"}` });
      },
      paste: (from, lines) => {
        const sel = selected.current;
        const order = recordRowsRef.current;
        const pool = sel.length >= 2 ? order.filter((r) => sel.some((s) => rowKeyOf(s) === rowKeyOf(r))) : order.slice(Math.max(0, order.findIndex((r) => rowKeyOf(r) === rowKeyOf(from))));
        const n = Math.min(lines.length, pool.length);
        const rows = pool.slice(0, n);
        const values = Object.fromEntries(rows.map((r, i) => [rowKeyOf(r), lines[i]]));
        for (const r of rows) drafts.delete(rowKeyOf(r));
        const into = sel.length >= 2 ? "selected rows" : "rows";
        const left = lines.length - n;
        void actions.decide(rows, "edit", { values, label: `Pasted ${n} ${n === 1 ? "value" : "values"} into ${n} ${into}${left > 0 ? `; ${left} ${left === 1 ? "line was" : "lines were"} left over` : ""}` });
      },
      owner: (row) => initials(row.assignee_email),
    }),
    [can, drafts, actions, toast],
  );

  const onChoose = useCallback(
    (row: WorkRow, choice: string) => {
      if (choice === "fix") {
        const typed = drafts.get(rowKeyOf(row))?.trim();
        if (typed) {
          drafts.delete(rowKeyOf(row));
          void actions.decide([row], "edit", { value: typed });
        } else void actions.decide([row], "accept");
      } else h.decide([row], choice === "accept risk" ? "accept_risk" : "not_an_issue");
    },
    [actions, drafts, h],
  );

  // Export and import ------------------------------------------------------------------------------------------
  const doExport = useCallback(async () => {
    try {
      const { filename } = await exportFixSheet(filtersOf(state));
      toast.show(`Fix sheet saved as ${filename}`);
    } catch (err) {
      toast.show(errorSentence(err, "The fix sheet could not be exported."), "error");
    }
  }, [state, toast]);

  const exportedOnce = useRef(false);
  useEffect(() => {
    if (params.get("export") !== "1" || exportedOnce.current || viewPending) return;
    exportedOnce.current = true;
    void doExport();
    const next = new URLSearchParams(search);
    next.delete("export");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [params, search, viewPending, doExport, router, pathname]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setImportOpen(true);
      setImp({ name: file.name, busy: true });
      try {
        const result = await importFixSheet(file);
        setImp({ name: file.name, busy: false, result });
        if (result.action_id) toast.done({ ids: [result.action_id], label: `Imported ${int(result.updated)} ${result.updated === 1 ? "decision" : "decisions"} from ${file.name}` });
        await refreshV2(qc);
      } catch (err) {
        setImp({ name: file.name, busy: false, error: errorSentence(err, "The file could not be read as a fix sheet.") });
      }
    },
    [qc, toast],
  );
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!can.apply || !e.dataTransfer.files.length) return;
    e.preventDefault();
    void onFile(e.dataTransfer.files[0]);
  };

  // Keyboard ---------------------------------------------------------------------------------------------------
  const keyTarget = useRef<LedgerTarget | null>(null);
  const needRows = useCallback(() => toast.show("Select rows first: x selects the highlighted row, Shift+J extends the selection."), [toast]);
  useEffect(() => {
    const t: LedgerTarget = {
      accept: () => {
        const rows = targets();
        if (!can.apply) return;
        if (rows.length) void actions.decide(rows, "accept").then((ok) => ok && gridHandle.current?.clear());
        else needRows();
      },
      notAnIssue: () => {
        const rows = targets();
        if (!can.approve) return;
        if (rows.length) setReason({ rows, kind: "not_an_issue", clear: () => gridHandle.current?.clear() });
        else needRows();
      },
      acceptRisk: () => {
        const rows = targets();
        if (!can.approve) return;
        if (rows.length) setReason({ rows, kind: "accept_risk", clear: () => gridHandle.current?.clear() });
        else needRows();
      },
      exportSheet: () => void doExport(),
      focusChips: () => chipsRef.current?.querySelector<HTMLElement>('button[aria-pressed="true"], button')?.focus(),
      step: (dir) => {
        const rows = recordRowsRef.current;
        const at = open?.kind === "record" ? rows.findIndex((r) => recordItemId(r) === open.id) : -1;
        const next = rows[at + dir];
        if (at < 0 || !next) return at >= 0;
        openItem({ kind: "record", id: recordItemId(next) });
        return true;
      },
    };
    keyTarget.current = t;
    ledgerRegistry.set(t);
    return () => ledgerRegistry.clear(t);
  }, [targets, can, actions, doExport, needRows, open, openItem]);

  // Words ------------------------------------------------------------------------------------------------------
  const [gridKey, bumpGrid] = useGridKey(COLUMNS_ID);
  const objectLabel = state.module ? objectName(state.module, labels) : null;
  const text = sentence({ persona: session.persona, chip: state.chip, summary, objectLabel, module: state.module });
  const topGroup = (groupsQ.data?.groups ?? []).find((g) => g.proposed > 0 && (!state.module || g.module === state.module));
  const headers = useMemo(() => keyHeaders(recordRows), [recordRows]);
  const compact = state.density === "compact";
  const [now] = useState(() => Date.now());

  const columns = useMemo<GridColumn<Item>[]>(() => {
    const r = <T,>(f: (row: WorkRow) => T) => (it: Item): T | null => (it.kind === "row" ? f(it.row) : null);
    const base: GridColumn<Item>[] = [
      { id: "record", header: headers.first, width: 170, pin: true, locked: true, title: `${headers.first}. Leading zeros are kept. Pinned.`, cell: r((x) => <Mono>{keyValue(x, 0) ?? x.record_key}</Mono>) },
      { id: "second", header: headers.second, width: 70, title: `${headers.second}, the second part of the record key. A dash when the record has none.`, cell: r((x) => (keyValue(x, 1) ? <Mono>{keyValue(x, 1)}</Mono> : <Dash why="This record has no second key part" />)) },
      { id: "name", header: "Name", width: 170, title: "The record's name.", cell: r((x) => (x.name ? <span title={x.name}>{x.name}</span> : <Dash />)) },
      { id: "rule", header: "Rule", width: 70, title: "Check id of the rule that rejected the value.", cell: r((x) => <Mono>{x.checks[0] ?? "—"}</Mono>) },
      {
        id: "severity",
        header: "Severity",
        width: 96,
        title: "Severity of the rule. Weights: critical 4, high 3, medium 2, low 1.",
        cell: r((x) => (
          <span className="m2-v">
            <SeverityMark severity={x.severity} />
            {x.severity.charAt(0).toUpperCase() + x.severity.slice(1)}
          </span>
        )),
      },
      { id: "fdesc", header: "Field description", width: 150, title: "Business name of the failing field.", cell: r((x) => (x.field_description ? <span title={x.field_description}>{x.field_description}</span> : <Dash why="The API has no description for this field yet" />)) },
      { id: "sapfield", header: "SAP field", width: 120, title: "TABLE.FIELD of the failing value.", cell: r((x) => (x.top_field ? <Mono>{x.top_field}</Mono> : <Dash />)) },
      { id: "problem", header: "Problem", width: 230, title: "What the rule found wrong with the value.", cell: r((x) => (x.top_message ? <span title={x.top_message}>{x.top_message}</span> : <Dash />)) },
      { id: "current", header: "Current value", width: 110, title: "The value held in SAP at extraction.", cell: r((x) => <CurrentValue value={x.current_value} />) },
      { id: "possible", header: "Possible values", width: 200, title: "Values the rule accepts. Open the row for the full list with meanings.", cell: r((x) => <PossibleValuesCell row={x} />) },
      { id: "suggested", header: "Suggested value", width: 120, title: "The value the rules propose. Blank when no single value is right.", cell: r((x) => (x.suggested_value ? <Mono>{x.suggested_value}</Mono> : <Dash why="No suggested value for this row" />)) },
      { id: "newvalue", header: "New value", width: 130, locked: true, title: "The value to write back. Type and press Enter, paste a column, or fill down with ⌘D.", cell: r((x) => <NewValueCell row={x} h={h} />) },
      { id: "decision", header: "Decision", width: 130, locked: true, title: "fix, not an issue or accept risk. The last two ask for a reason.", cell: r((x) => <DecisionCell row={x} h={h} onChoose={onChoose} />) },
      { id: "first", header: "First seen", width: 100, title: "The date the oldest failing issue of this row was first seen.", cell: r((x) => (x.first_seen_at ? <span>{new Date(x.first_seen_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span> : <Dash />)) },
      { id: "days", header: "Days open", width: 90, numeric: true, title: "Days since this row was first seen.", cell: r((x) => { const d = daysOpen(x.first_seen_at, now); return d == null ? <Dash /> : <>{int(d)}</>; }) },
      { id: "owner", header: "Owner", width: 70, title: "The steward the row is assigned to, by initials.", cell: r((x) => <OwnerCell row={x} h={h} />) },
      { id: "value", header: "Value at risk", width: 120, numeric: true, title: "Cost-model estimate of what this failing value costs.", cell: r((x) => (x.value_at_risk == null ? <Dash /> : <>{int(x.value_at_risk)}</>)) },
    ];
    if (state.chip === "exceptions") {
      // Signed off: what the decision was, why, by whom and when; stewards can reopen it.
      const keep = new Set(["record", "second", "name", "rule", "severity", "fdesc", "sapfield", "problem", "current"]);
      const value = base.find((c) => c.id === "value");
      return [
        ...base.filter((c) => keep.has(c.id)),
        { id: "resolution", header: "Resolution", width: 120, locked: true, title: "Not an issue, or the risk was accepted.", cell: r((x) => (x.resolution === "accepted_risk" ? "Accept risk" : x.resolution === "false_positive" ? "Not an issue" : <Dash why="The API has not said how this record was signed off" />)) },
        { id: "reason", header: "Reason", width: 280, locked: true, title: "The reason given when the record was signed off.", cell: r((x) => (x.resolution_note ? <span title={x.resolution_note}>{x.resolution_note}</span> : <Dash why="The API does not send the reason yet" />)) },
        { id: "by", header: "Signed off by", width: 130, locked: true, title: "Who signed the record off.", cell: r((x) => x.resolved_by ?? <Dash why="The API does not send who signed off yet" />) },
        { id: "when", header: "When", width: 100, locked: true, title: "The date of the sign-off.", cell: r((x) => (x.resolved_at ? <span>{day(x.resolved_at)}</span> : <Dash why="The API does not send when yet" />)) },
        ...(value ? [value] : []),
        {
          id: "reopen",
          header: "Reopen",
          width: 96,
          locked: true,
          title: "Puts the record back to rows to fix. Needs the apply permission.",
          cell: r((x) =>
            can.apply ? (
              <button type="button" className="m2-btn m2-sm m2-reopen" aria-label={`Reopen ${keyValue(x, 0) ?? x.record_key}`} onClick={() => void actions.decide([x], "reopen")}>
                Reopen
              </button>
            ) : (
              <Dash why="Reopening needs the apply permission" />
            ),
          ),
        },
      ];
    }
    if (state.chip === null) {
      // All open states: say where each record is.
      const at = base.findIndex((c) => c.id === "severity");
      const status: GridColumn<Item> = { id: "status", header: "Status", width: 150, locked: true, title: "Where the record is: to fix, waiting for approval, approved, or sent to SAP.", cell: r((x) => STATUS_LABEL[x.status] ?? x.status) };
      return [...base.slice(0, at + 1), status, ...base.slice(at + 1)];
    }
    return base;
  }, [headers, h, onChoose, now, state.chip, can.apply, actions]);

  // Views menu -------------------------------------------------------------------------------------------------
  const goView = (id: string | null) => {
    const next = new URLSearchParams(search);
    for (const k of MANAGED) next.delete(k);
    if (id) next.set("view", id);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const viewEntries: MenuEntry[] = [
    { kind: "heading", label: "Views" },
    ...(viewsQ.data?.views ?? []).map<MenuEntry>((v) => ({ kind: "item", id: v.id, label: v.name, sub: v.builtin ? "Built in" : undefined, checked: viewId === v.id, variant: "radio", onSelect: () => goView(v.id) })),
    { kind: "separator" },
    { kind: "item", id: "reset", label: "Reset to the default view", onSelect: () => goView(null) },
    { kind: "item", id: "save", label: "Save current view…", onSelect: () => setSaving(true) },
  ];

  // The strip of filters in force beyond the chip, each one removable.
  const tags: { key: string; label: string; clear: () => void }[] = [];
  if (state.rule) tags.push({ key: "rule", label: `Rule ${state.rule}`, clear: () => go({ rule: null }) });
  if (state.severity) tags.push({ key: "severity", label: `Severity ${state.severity}`, clear: () => go({ severity: null }) });
  if (state.assigned) tags.push({ key: "assigned", label: state.assigned === "me" ? "Assigned to me" : state.assigned === "unassigned" ? "Unassigned" : "Assigned", clear: () => go({ assigned: null }) });
  if (state.batch) tags.push({ key: "batch", label: `Batch ${batchLabel(state.batch)}`, clear: () => go({ batch: null }) });
  if (state.due) tags.push({ key: "due", label: state.due === "overdue" ? "Overdue" : "Due soon", clear: () => go({ due: null }) });

  const shown = grouped ? recordRows.length : flatRows.length;
  const total = grouped ? null : (rowsQ.data?.pages[0]?.total ?? null);
  const loading = grouped ? groupsQ.isPending : rowsQ.isPending || viewPending;
  const failed = grouped ? groupsQ.isError : rowsQ.isError;
  const hasMore = !grouped && rowsQ.hasNextPage;
  const clearFilters = () => goView(null);

  const empty = (
    <EmptyFrame
      action={
        tags.length || state.chip !== "tofix" ? (
          <button type="button" className="m2-btn" onClick={clearFilters}>
            Clear filters
          </button>
        ) : (
          <V2Link href="/v2/runs" className="m2-btn">
            Open the runs
          </V2Link>
        )
      }
    >
      {summary && summary.built === false
        ? "The work list of the latest run is not built yet, so no rows can be listed. It is built after each run finishes."
        : state.chip === "approvals"
          ? "No value is waiting for approval. Accepted and entered values land here until a second person approves them."
          : state.chip === "exceptions"
            ? "No record is signed off as not an issue or an accepted risk."
            : "No rows in this view. Rows fill when an analysis finds a failing value with a fix; widen the view or clear its filters."}
    </EmptyFrame>
  );

  const toggleGroup = (check: string) =>
    setExpanded((cur) => {
      const base = cur ?? openGroups;
      const next = { ...base };
      if (check in next) delete next[check];
      else next[check] = GROUP_ROWS;
      return next;
    });

  const spanRow = (it: Item) => {
    if (it.kind === "group") {
      const g = it.group;
      const left = g.proposed;
      const done = !left && (g.statuses.proposed ?? 0) > 0;
      return (
        <div className="m2-gb">
          <button type="button" className="m2-gt" aria-expanded={it.open} aria-label={`${g.check_id}, ${g.message ?? ""}`} onClick={() => toggleGroup(g.check_id)}>
            <IconChevron open={it.open} />
            <Mono>{g.check_id}</Mono>
            <span>{g.message ?? g.check_id}</span>
          </button>
          <span className="m2-meta">{`${int(g.records)} rows`}</span>
          <span className="m2-gx">
            {left > 0 ? (
              can.apply ? (
                <button type="button" className="m2-btn m2-sm" onClick={() => void actions.acceptRule(g.check_id, left, g.version_id, recordRows)}>
                  {`Accept all ${int(left)} suggested`}
                </button>
              ) : (
                <span className="m2-meta">{`${int(left)} suggested`}</span>
              )
            ) : done ? (
              <span className="m2-meta">Suggested values accepted</span>
            ) : null}
          </span>
        </div>
      );
    }
    if (it.kind === "batch") {
      const b = it.batch;
      return (
        <div className="m2-bh" data-testid={`batch-row-${b.id}`}>
          <span className="m2-bh-id">
            <V2Link href={`${pathname}?${withState(search, state, { open: `batch:${b.id}` })}`} aria-label={`Open batch ${b.label}`}>
              <Mono>{b.label}</Mono>
            </V2Link>
          </span>
          <span className="m2-bh-name" title={b.name}>
            {b.name}
          </span>
          {b.status === "exported" ? (
            <span className="m2-bh-sent">{sentLine(b, day)}</span>
          ) : (
            <>
              <span className="m2-bh-meta">{b.status === "approved" ? `Approved${b.approvedBy ? ` by ${b.approvedBy}` : ""}` : (b.owner ?? "No owner")}</span>
              <span className="m2-bh-meta">{`${int(b.records)} ${b.records === 1 ? "record" : "records"}`}</span>
              <span className="m2-bh-meta">{b.valueAtRisk == null ? "no value at risk" : <>{money(b.valueAtRisk)} at risk</>}</span>
              <span className="m2-bh-meta">{b.dueAt ? `due ${day(b.dueAt)}` : "no due date"}</span>
            </>
          )}
          <span className="m2-sr">{BATCH_STATUS_LABEL[b.status]}</span>
          <span className="m2-bh-x">
            <BatchButtons b={b} c={controls} />
            {b.status !== "draft" ? (
              <V2Link href={`${pathname}?${withState(search, { ...state, chip: null, batch: b.id, group: false })}`} className="m2-btn m2-sm">
                Show records
              </V2Link>
            ) : null}
          </span>
        </div>
      );
    }
    if (it.kind === "more") {
      return (
        <div className="m2-gb">
          <span className="m2-meta">{`${int(it.shown)} of ${int(it.total)} rows of ${it.check} shown`}</span>
          <button type="button" className="m2-btn m2-sm" onClick={() => setExpanded((cur) => ({ ...(cur ?? openGroups), [it.check]: (cur ?? openGroups)[it.check] + GROUP_ROWS * 2 }))}>
            {`Show ${Math.min(GROUP_ROWS * 2, it.total - it.shown)} more`}
          </button>
        </div>
      );
    }
    return null;
  };

  const toolbar = (
    <div className="m2-tool" role="toolbar" aria-label="Ledger controls">
      <div className="m2-seg" role="group" aria-label="Grouping">
        <button type="button" aria-pressed={!grouped} onClick={() => go({ group: false })}>
          Flat
        </button>
        <button type="button" aria-pressed={grouped} disabled={!GROUPABLE.has(state.chip)} title={GROUPABLE.has(state.chip) ? undefined : "Grouping applies to rows to fix"} onClick={() => go({ group: true })}>
          By rule
        </button>
      </div>
      <label className="m2-selbox">
        <span className="m2-meta">Sort</span>
        <select className="m2-sel" aria-label="Sort by" value={state.sort} onChange={(e) => go({ sort: e.target.value as SortKey })}>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="m2-seg m2-only-wide" role="group" aria-label="Row density">
        {(["compact", "comfortable"] as Density[]).map((d) => (
          <button key={d} type="button" aria-pressed={state.density === d} title={d === "compact" ? "Rows 28 pixels" : "Rows 32 pixels"} onClick={() => go({ density: d })}>
            {d === "compact" ? "Compact" : "Standard"}
          </button>
        ))}
      </div>
      <MenuButton label="Views" entries={viewEntries} className="m2-btn m2-sm">
        Views
        <Dot />
        {view?.name ?? "Unsaved"}
      </MenuButton>
      <label className="m2-selbox">
        <span className="m2-meta">Object</span>
        <select className="m2-sel" aria-label="Object" value={state.module ?? ""} onChange={(e) => go({ module: e.target.value || null })}>
          <option value="">All objects</option>
          {(summary?.objects ?? []).map((o) => (
            <option key={o.module} value={o.module}>
              {objectName(o.module, labels)}
            </option>
          ))}
        </select>
      </label>
      <span className="m2-tool-sp" />
      <button type="button" className="m2-btn m2-sm" onClick={() => void doExport()}>
        Export fix sheet <kbd className="m2-kb">e</kbd>
      </button>
      {can.apply ? (
        <button type="button" className="m2-btn m2-sm" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>
          Import filled sheet
        </button>
      ) : null}
    </div>
  );

  const countText = grouped
    ? `${int(groups.length)} of ${int(groupsQ.data?.total ?? groups.length)} rules shown`
    : total != null
      ? `Showing ${int(Math.min(shown, total))} of ${int(total)}${rowsQ.data?.pages[0]?.total_capped ? " or more" : ""}`
      : "";
  const loadedNote = !grouped && SORTS_LOADED_ROWS.has(state.sort) && (hasMore || (total ?? 0) > shown) ? `Sorted by ${SORT_LABEL[state.sort].toLowerCase()} within the rows loaded.` : "";

  return (
    <div onDragOver={(e) => can.apply && e.preventDefault()} onDrop={onDrop} data-testid="work-ledger">
      <PageTitle sub={objectLabel ?? "All objects"}>Work</PageTitle>
      {text ? (
        <p className="m2-finding" data-testid="work-sentence">
          {text}
        </p>
      ) : null}
      <FixOrderHint module={state.module} />
      <p className="m2-prov m2-only-wide">{`Rows are read from the latest run of each object${status?.cost_model ? `. Value at risk is from cost model ${status.cost_model}` : ""}.`}</p>
      {session.persona === "steward" && can.apply && topGroup && state.chip !== "approvals" && state.chip !== "exceptions" ? (
        <div className="m2-cta">
          <button type="button" className="m2-btn m2-next" onClick={() => void actions.acceptRule(topGroup.check_id, topGroup.proposed, topGroup.version_id, recordRows)}>
            {`Accept the ${int(topGroup.proposed)} suggested ${topGroup.proposed === 1 ? "value" : "values"}`}
          </button>
          <span className="m2-meta m2-only-wide">
            for <Mono>{topGroup.check_id}</Mono>, the rule with the most at risk
          </span>
        </div>
      ) : null}
      <div className="m2-ledger-head">
        <Chips state={state} counts={counts} set={(chip) => go({ chip, group: chip === "approvals" || chip === "exceptions" ? false : state.group })} groupRef={chipsRef} />
        {tags.length ? (
          <ul className="m2-tags" aria-label="Filters in force">
            {tags.map((t) => (
              <li key={t.key}>
                <span>{t.label}</span>
                <button type="button" aria-label={`Remove filter: ${t.label}`} onClick={t.clear}>
                  <IconClose />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {toolbar}
      {importOpen ? (
        <div className="m2-drop" data-testid="import-panel">
          <span>
            {imp?.busy
              ? `Reading ${imp.name}…`
              : "Drop the filled fix sheet here, or choose a file (.xlsx). Meridian checks keys, SAP fields and values before anything changes."}
          </span>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="m2-sr" aria-label="Choose a filled fix sheet" onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" className="m2-btn m2-sm" onClick={() => fileRef.current?.click()}>
            Choose file
          </button>
        </div>
      ) : null}
      {imp && !imp.busy ? (
        imp.error ? (
          <ErrorFrame>{imp.error}</ErrorFrame>
        ) : imp.result ? (
          <div className="m2-banner" role="status" data-testid="import-result">
            <p style={{ margin: 0 }}>
              {`${imp.name}: ${int(imp.result.updated)} ${imp.result.updated === 1 ? "decision" : "decisions"} saved from ${int(imp.result.rows)} ${imp.result.rows === 1 ? "row" : "rows"}${imp.result.skipped.length ? `; ${int(imp.result.skipped.length)} skipped` : ""}.`}
            </p>
            {imp.result.skipped.length ? (
              <ul className="m2-skipped">
                {imp.result.skipped.slice(0, 5).map((s) => (
                  <li key={s}>{s}</li>
                ))}
                {imp.result.skipped.length > 5 ? <li>{`and ${imp.result.skipped.length - 5} more`}</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null
      ) : null}
      {state.batch && flatRows.some((r) => r.batch_id === undefined) ? (
        <div className="m2-banner" role="status" data-testid="batch-unfiltered">
          This list is not narrowed to the batch yet: the API does not send the batch of a row. The batch inspector lists its records.
        </div>
      ) : null}
      {sent ? (
        <ResultFrame outcome={sent}>
          <span>
            <button type="button" className="m2-btn m2-sm" onClick={() => setSent(null)}>
              Dismiss
            </button>
          </span>
        </ResultFrame>
      ) : null}
      <div className="m2-lcount" aria-live="polite">
        <span>{countText}</span>
        {loadedNote ? <span className="m2-meta m2-only-wide">{loadedNote}</span> : null}
        {hasMore ? (
          <button type="button" className="m2-btn m2-sm" disabled={rowsQ.isFetchingNextPage} onClick={() => void rowsQ.fetchNextPage()}>
            {`Show ${PAGE} more`}
          </button>
        ) : null}
      </div>
      {phone ? (
        <LedgerList items={items} loading={loading} failed={failed} empty={empty} onRetry={() => void (grouped ? groupsQ.refetch() : rowsQ.refetch())} exceptions={state.chip === "exceptions"} headers={headers} openId={open?.kind === "record" ? open.id : null} onOpen={(row) => openItem({ kind: "record", id: recordItemId(row) })} spanRow={spanRow} />
      ) : (
        <Grid<Item>
          key={gridKey}
          id={COLUMNS_ID}
          toolbar={<GridTools gridId={COLUMNS_ID} route="work" title="Work" columns={columns} rows={items} filters={Object.fromEntries(Object.entries({ module: state.module, rule: state.rule, severity: state.severity, assigned: state.assigned }).filter(([, v]) => v)) as Record<string, string>} onColumns={bumpGrid} />}
          handleRef={gridHandle}
          ariaLabel="Work ledger"
          columns={columns}
          rows={items}
          rowId={itemId}
          compact={compact}
          height={560}
          selectable={can.apply || can.approve || can.assign}
          spanRow={spanRow}
          count={recordRows.length}
          bulkLabel={(n) => `${n.toLocaleString("en-US")} ${n === 1 ? "record" : "records"}`}
          loading={loading}
          error={failed ? <ErrorFrame onRetry={() => void (grouped ? groupsQ.refetch() : rowsQ.refetch())}>The rows to fix could not be read.</ErrorFrame> : undefined}
          emptyFrame={empty}
          onOpen={(it) => (it.kind === "row" ? openItem({ kind: "record", id: recordItemId(it.row) }) : it.kind === "group" ? toggleGroup(it.group.check_id) : it.kind === "batch" ? openItem({ kind: "batch", id: it.batch.id }) : undefined)}
          openRowId={open?.kind === "record" ? open.id : null}
          onActiveChange={(it) => {
            active.current = it?.kind === "row" ? it.row : undefined;
          }}
          onSelectionChange={(sel) => {
            selected.current = sel.flatMap((it) => (it.kind === "row" ? [it.row] : []));
          }}
          bulkBar={(ctx) => (
            <BulkActions
              rows={ctx.selected.flatMap((it) => (it.kind === "row" ? [it.row] : []))}
              clear={ctx.clear}
              h={h}
              onReason={(rows, kind, clear) => setReason({ rows, kind, clear })}
            />
          )}
        />
      )}
      {controls.dialog}
      {reason ? (
        <PromptDialog
          title={reason.kind === "not_an_issue" ? "Mark as not an issue" : "Accept the risk"}
          description={`${reason.rows.length.toLocaleString("en-US")} ${reason.rows.length === 1 ? "record" : "records"} will leave the list of rows to fix and show under Exceptions.`}
          label="Reason"
          confirm={reason.kind === "not_an_issue" ? "Mark as not an issue" : "Accept the risk"}
          multiline
          onCancel={() => setReason(null)}
          onConfirm={(note) => {
            const r = reason;
            setReason(null);
            void actions.decide(r.rows, r.kind, { note }).then((ok) => ok && r.clear?.());
          }}
        />
      ) : null}
      {saving ? (
        <PromptDialog
          title="Save this view"
          label="Name"
          confirm="Save view"
          description="Keeps the filters, the grouping, the sort and the row density. Open it again from Views."
          onCancel={() => setSaving(false)}
          onConfirm={(name) => {
            setSaving(false);
            void viewsQ
              .save({ route: "work", name, filters: viewFilters(state), columns: null, density: state.density })
              .then((saved) => {
                toast.show(`Saved the view ${saved.name}`);
                goView(saved.id);
              })
              .catch((err) => toast.show(errorSentence(err, "The view could not be saved."), "error"));
          }}
        />
      ) : null}
    </div>
  );
}

/** Phone: each row is two lines in a list; editing happens in the inspector. */
function LedgerList({
  items,
  loading,
  failed,
  empty,
  onRetry,
  headers,
  exceptions,
  openId,
  onOpen,
  spanRow,
}: {
  items: Item[];
  loading: boolean;
  failed: boolean;
  empty: React.ReactNode;
  onRetry: () => void;
  headers: { first: string; second: string };
  exceptions: boolean;
  openId: string | null;
  onOpen: (row: WorkRow) => void;
  spanRow: (it: Item) => React.ReactNode;
}) {
  if (failed) return <ErrorFrame onRetry={onRetry}>The rows to fix could not be read.</ErrorFrame>;
  if (loading) return <div aria-busy="true" className="m2-meta">Reading the rows to fix…</div>;
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="m2-mlist" role="list" aria-label="Work ledger">
      {items.map((it) => {
        if (it.kind !== "row") return <div key={itemId(it)} role="listitem" className="m2-lgroup">{spanRow(it)}</div>;
        const r = it.row;
        const id = recordItemId(r);
        const d = daysOpen(r.first_seen_at);
        const second = keyValue(r, 1);
        return (
          <div key={id} role="listitem">
            <button type="button" className="m2-lrow" data-open={openId === id ? "true" : undefined} title={d != null ? `${int(d)} days open` : undefined} onClick={() => onOpen(r)}>
              <span>
                <span className="m2-mono">{keyValue(r, 0) ?? r.record_key}</span> <span className="m2-mono m2-meta">{r.checks[0] ?? ""}</span>
              </span>
              <span className="m2-meta">{r.value_at_risk == null ? "—" : int(r.value_at_risk)}</span>
              <span className="m2-c m2-clip">
                {[r.name, second ? `${headers.second.toLowerCase()} ${second}` : null, `${r.top_message ?? ""}${r.current_value ? `: ${r.current_value}` : ""}${r.suggested_value ? ` to ${r.suggested_value}` : ""}`, exceptions ? `${r.resolution === "accepted_risk" ? "Accept risk" : "Not an issue"}${r.resolution_note ? `: ${r.resolution_note}` : ""}${r.resolved_by ? `, ${r.resolved_by}` : ""}` : null].filter(Boolean).map((part, n) => (n === 0 ? <span key={n}>{part}</span> : <span key={n}><Dot />{part}</span>))}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
