"use client";

import { Money } from "../Money";
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
import { ConfirmBar } from "../forms";
import { needsConfirm, useWorkActions, useWorkCan, type DecideKind } from "@/lib/v2/work-actions";
import { patched, usePatches } from "@/lib/v2/work-overrides";
import { PAGE, useGroupRows, useWorkGroups, useWorkRows, useWorkSummary, useWorkViews } from "@/lib/v2/work-queries";
import { Grid, type GridColumn, type GridHandle } from "../Grid";
import { IconChevron, IconClose, SeverityMark } from "../marks";
import { MenuButton, type MenuEntry } from "../Menu";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
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
import { t as tr, lc } from "@/lib/v2/i18n";
import { alphaOut, whole } from "@/lib/v2/format";
import { formatDate } from "@/lib/format";
import { useRunList } from "@/lib/v2/queries";
import { policyLabel } from "@/lib/v2/step10";
import { usePolicyPacks } from "@/lib/v2/step10-queries";
import "../step10.css";

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

function Chips({ state, counts, set, groupRef, policy }: { state: LedgerState; counts: Map<ChipId, number | null>; set: (chip: ChipId | null) => void; groupRef: React.RefObject<HTMLDivElement | null>; policy: React.ReactNode }) {
  return (
    <div className="m2-chips" role="group" aria-label={tr("Filter by state")} ref={groupRef}>
      {CHIPS.map((c) => {
        const n = counts.get(c.id);
        return (
          <button key={c.id} type="button" className="m2-chip" aria-pressed={state.chip === c.id} onClick={() => set(state.chip === c.id ? null : c.id)}>
            {c.label} <span className="m2-chip-n">{n == null ? "—" : int(n)}</span>
          </button>
        );
      })}
      {policy}
    </div>
  );
}

/** Step 10: the Policy chip. Its menu lists the applied packs and their classes; choosing one narrows the ledger (`policy=`). */
function PolicyChip({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const q = usePolicyPacks();
  const applied = (q.data?.packs ?? []).filter((p) => p.applied || value?.split(":")[0] === p.id);
  const entries: MenuEntry[] = [
    { kind: "item", id: "none", label: tr("Any policy"), variant: "radio", checked: !value, onSelect: () => onChange(null) },
    ...applied.flatMap<MenuEntry>((p) => [
      { kind: "heading", label: p.name },
      { kind: "item", id: p.id, label: tr("Every class of {pack}", { pack: p.name }), variant: "radio", checked: value === p.id, onSelect: () => onChange(p.id) },
      ...p.classes.map<MenuEntry>((c) => ({ kind: "item", id: `${p.id}:${c.id}`, label: c.label, sub: c.breached ? tr("breached") : undefined, variant: "radio", checked: value === `${p.id}:${c.id}`, onSelect: () => onChange(`${p.id}:${c.id}`) })),
    ]),
    ...(q.isSuccess && applied.length === 0 ? [{ kind: "heading", label: tr("No policy pack is applied. Apply one under Administration, Policy packs.") } as MenuEntry] : []),
  ];
  return (
    <MenuButton label={tr("Policy")} entries={entries} className="m2-chip">
      <span data-testid="policy-chip" aria-hidden="true" />
      {value ? tr("Policy: {label}", { label: policyLabel(value, q.data?.packs) }) : tr("Policy")}
    </MenuButton>
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
  // A policy class or a past run is read by GET /work/records alone: the rule groups and the fix sheet do not take them.
  const narrowed = Boolean(state.policy || state.asOf);
  const grouped = state.group && GROUPABLE.has(state.chip) && !narrowed;
  const packs = usePolicyPacks().data?.packs;
  const runList = useRunList();
  const asOfRun = state.asOf ? runList.data?.versions.find((v) => v.id === state.asOf) : undefined;
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
  // A bulk change over CONFIRM_OVER rows waits here until the person confirms it (Enter) or keeps the rows (Escape).
  const [bulk, setBulk] = useState<{ count: number; message: string; confirm: string; run: () => void } | null>(null);
  const ask = useCallback((count: number, message: string, confirm: string, run: () => void) => {
    if (needsConfirm(count)) setBulk({ count, message, confirm, run });
    else run();
  }, [setBulk]);
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
          toast.show(tr("Select the rows to fill, then press ⌘D in the New value you want to copy."));
          return;
        }
        const rows = sel.some((r) => rowKeyOf(r) === rowKeyOf(from)) ? sel : [from, ...sel];
        drafts.delete(rowKeyOf(from));
        void actions.decide(rows, "edit", { value, label: tr("Filled {value} down {rowsCount} {rowsCount2, plural, one {row} other {rows}}", { value, rowsCount: whole(rows.length), rowsCount2: rows.length }) });
      },
      paste: (from, lines) => {
        const sel = selected.current;
        const order = recordRowsRef.current;
        const pool = sel.length >= 2 ? order.filter((r) => sel.some((s) => rowKeyOf(s) === rowKeyOf(r))) : order.slice(Math.max(0, order.findIndex((r) => rowKeyOf(r) === rowKeyOf(from))));
        const n = Math.min(lines.length, pool.length);
        const rows = pool.slice(0, n);
        const values = Object.fromEntries(rows.map((r, i) => [rowKeyOf(r), lines[i]]));
        for (const r of rows) drafts.delete(rowKeyOf(r));
        const into = sel.length >= 2 ? tr("selected rows") : tr("rows");
        const left = lines.length - n;
        void actions.decide(rows, "edit", { values, label: tr("Pasted {n} {n, plural, one {value} other {values}} into {n} {into}{value}", { n, into, value: left > 0 ? tr("; {left} {left, plural, one {line was} other {lines were}} left over", { left }) : "" }) });
      },
      owner: (row) => initials(row.assignee_email),
    }),
    [can, drafts, actions, toast, setReason],
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
      toast.show(tr("Fix sheet saved as {filename}", { filename }));
    } catch (err) {
      toast.show(errorSentence(err, tr("The fix sheet could not be exported.")), "error");
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
        if (result.action_id) toast.done({ ids: [result.action_id], label: tr("Imported {updated} {updated2, plural, one {decision} other {decisions}} from {name}", { updated: int(result.updated), updated2: result.updated, name: file.name }) });
        await refreshV2(qc);
      } catch (err) {
        setImp({ name: file.name, busy: false, error: errorSentence(err, tr("The file could not be read as a fix sheet.")) });
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
  const needRows = useCallback(() => toast.show(tr("Select rows first: x selects the highlighted row, Shift+J extends the selection.")), [toast]);
  useEffect(() => {
    const t: LedgerTarget = {
      accept: () => {
        const rows = targets();
        if (!can.apply) return;
        if (rows.length) ask(rows.length, tr("Accept the suggested value on {count} rows?", { count: int(rows.length) }), tr("Accept {count} values", { count: int(rows.length) }), () => void actions.decide(rows, "accept").then((ok) => ok && gridHandle.current?.clear()));
        else needRows();
      },
      notAnIssue: () => {
        const rows = targets();
        if (!can.approve) return;
        if (rows.length) ask(rows.length, tr("Mark {count} rows as not an issue?", { count: int(rows.length) }), tr("Continue with {count} rows", { count: int(rows.length) }), () => setReason({ rows, kind: "not_an_issue", clear: () => gridHandle.current?.clear() }));
        else needRows();
      },
      acceptRisk: () => {
        const rows = targets();
        if (!can.approve) return;
        if (rows.length) ask(rows.length, tr("Accept the risk on {count} rows?", { count: int(rows.length) }), tr("Continue with {count} rows", { count: int(rows.length) }), () => setReason({ rows, kind: "accept_risk", clear: () => gridHandle.current?.clear() }));
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
  }, [targets, can, actions, doExport, needRows, open, openItem, ask]);

  // While the confirmation bar shows, Enter confirms and Escape keeps the rows; nothing else on the page takes them.
  useEffect(() => {
    if (!bulk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setBulk(null);
      if (e.key === "Enter") bulk.run();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [bulk]);

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
      { id: "record", header: headers.first, width: 170, pin: true, locked: true, title: tr("{first}, as SAP shows it (leading zeros of a numeric key left out; the full key is on hover). Pinned.", { first: headers.first }), cell: r((x) => <KeyText value={keyValue(x, 0) ?? x.record_key} />) },
      { id: "second", header: headers.second, width: 70, title: tr("{second}, the second part of the record key. A dash when the record has none.", { second: headers.second }), cell: r((x) => (keyValue(x, 1) ? <Mono>{keyValue(x, 1)}</Mono> : <Dash why={tr("This record has no second key part")} />)) },
      { id: "name", header: tr("Name"), width: 170, title: tr("The record's name."), cell: r((x) => (x.name ? <span title={x.name}>{x.name}</span> : <Dash />)) },
      { id: "rule", header: tr("Rule"), width: 70, title: tr("Check id of the rule that rejected the value."), cell: r((x) => <Mono>{x.checks[0] ?? "—"}</Mono>) },
      {
        id: "severity",
        header: tr("Severity"),
        width: 96,
        title: tr("Severity of the rule. Weights: critical 4, high 3, medium 2, low 1."),
        cell: r((x) => (
          <span className="m2-v">
            <SeverityMark severity={x.severity} />
            {x.severity.charAt(0).toUpperCase() + x.severity.slice(1)}
          </span>
        )),
      },
      { id: "current", header: tr("Current value"), width: 110, title: tr("The value held in SAP at extraction."), cell: r((x) => <CurrentValue value={x.current_value} />) },
      { id: "suggested", header: tr("Suggested value"), width: 120, title: tr("The value the rules propose. Blank when no single value is right."), cell: r((x) => (x.suggested_value ? <Mono>{x.suggested_value}</Mono> : <Dash why={tr("No suggested value for this row")} />)) },
      { id: "newvalue", header: tr("New value"), width: 130, locked: true, title: tr("The value to write back. Type and press Enter, paste a column, or fill down with ⌘D."), cell: r((x) => <NewValueCell row={x} h={h} />) },
      { id: "decision", header: tr("Decision"), width: 130, locked: true, title: tr("fix, not an issue or accept risk. The last two ask for a reason."), cell: r((x) => <DecisionCell row={x} h={h} onChoose={onChoose} />) },
      { id: "fdesc", header: tr("Field description"), width: 150, defaultHidden: true, title: tr("Business name of the failing field."), cell: r((x) => (x.field_description ? <span title={x.field_description}>{x.field_description}</span> : <Dash why={tr("The API has no description for this field yet")} />)) },
      { id: "sapfield", header: tr("SAP field"), width: 120, title: tr("TABLE.FIELD of the failing value."), cell: r((x) => (x.top_field ? <Mono>{x.top_field}</Mono> : <Dash />)) },
      { id: "problem", header: tr("Problem"), width: 230, title: tr("What the rule found wrong with the value."), cell: r((x) => (x.top_message ? <span title={x.top_message}>{x.top_message}</span> : <Dash />)) },
      { id: "possible", header: tr("Possible values"), width: 200, defaultHidden: true, title: tr("Values the rule accepts. Open the row for the full list with meanings."), cell: r((x) => <PossibleValuesCell row={x} />) },
      { id: "first", header: tr("First seen"), width: 100, defaultHidden: true, title: tr("The date the oldest failing issue of this row was first seen."), cell: r((x) => (x.first_seen_at ? <span title={formatDate(x.first_seen_at, "date")}>{formatDate(x.first_seen_at, "day")}</span> : <Dash />)) },
      { id: "days", header: tr("Days open"), width: 90, defaultHidden: true, numeric: true, title: tr("Days since this row was first seen."), cell: r((x) => { const d = daysOpen(x.first_seen_at, now); return d == null ? <Dash /> : <>{int(d)}</>; }) },
      { id: "owner", header: tr("Owner"), width: 70, title: tr("The steward the row is assigned to, by initials."), cell: r((x) => <OwnerCell row={x} h={h} />) },
      { id: "value", header: tr("Value at risk"), width: 120, numeric: true, title: tr("Cost-model estimate of what this failing value costs."), cell: r((x) => (x.value_at_risk == null ? <Dash /> : <Money amount={x.value_at_risk} compact={false} />)) },
    ];
    if (state.chip === "exceptions") {
      // Signed off: what the decision was, why, by whom and when; stewards can reopen it.
      const keep = new Set(["record", "second", "name", "rule", "severity", "fdesc", "sapfield", "problem", "current"]);
      const value = base.find((c) => c.id === "value");
      return [
        ...base.filter((c) => keep.has(c.id)),
        { id: "resolution", header: tr("Resolution"), width: 120, locked: true, title: tr("Not an issue, or the risk was accepted."), cell: r((x) => (x.resolution === "accepted_risk" ? tr("Accept risk") : x.resolution === "false_positive" ? tr("Not an issue") : <Dash why={tr("The API has not said how this record was signed off")} />)) },
        { id: "reason", header: tr("Reason"), width: 280, locked: true, title: tr("The reason given when the record was signed off."), cell: r((x) => (x.resolution_note ? <span title={x.resolution_note}>{x.resolution_note}</span> : <Dash why={tr("The API does not send the reason yet")} />)) },
        { id: "by", header: tr("Signed off by"), width: 130, locked: true, title: tr("Who signed the record off."), cell: r((x) => x.resolved_by ?? <Dash why={tr("The API does not send who signed off yet")} />) },
        { id: "when", header: tr("When"), width: 100, locked: true, title: tr("The date of the sign-off."), cell: r((x) => (x.resolved_at ? <span>{day(x.resolved_at)}</span> : <Dash why={tr("The API does not send when yet")} />)) },
        ...(value ? [value] : []),
        {
          id: "reopen",
          header: tr("Reopen"),
          width: 96,
          locked: true,
          title: tr("Puts the record back to rows to fix. Needs the apply permission."),
          cell: r((x) =>
            can.apply ? (
              <button type="button" className="m2-btn m2-sm m2-reopen" aria-label={tr("Reopen {keyValue}", { keyValue: keyValue(x, 0) ?? x.record_key })} onClick={() => void actions.decide([x], "reopen")}>
                {tr("Reopen")}
              </button>
            ) : (
              <Dash why={tr("Reopening needs the apply permission")} />
            ),
          ),
        },
      ];
    }
    if (state.chip === null) {
      // All open states: say where each record is.
      const at = base.findIndex((c) => c.id === "severity");
      const status: GridColumn<Item> = { id: "status", header: tr("Status"), width: 150, locked: true, title: tr("Where the record is: to fix, waiting for approval, approved, or sent to SAP."), cell: r((x) => STATUS_LABEL[x.status] ?? x.status) };
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
    { kind: "heading", label: tr("Views") },
    ...(viewsQ.data?.views ?? []).map<MenuEntry>((v) => ({ kind: "item", id: v.id, label: v.name, sub: v.builtin ? tr("Built in") : undefined, checked: viewId === v.id, variant: "radio", onSelect: () => goView(v.id) })),
    { kind: "separator" },
    { kind: "item", id: "reset", label: tr("Reset to the default view"), onSelect: () => goView(null) },
    { kind: "item", id: "save", label: tr("Save current view…"), onSelect: () => setSaving(true) },
  ];

  // The strip of filters in force beyond the chip, each one removable.
  const tags: { key: string; label: string; clear: () => void }[] = [];
  if (state.rule) tags.push({ key: "rule", label: tr("Rule {rule}", { rule: state.rule }), clear: () => go({ rule: null }) });
  if (state.severity) tags.push({ key: "severity", label: tr("Severity {severity}", { severity: state.severity }), clear: () => go({ severity: null }) });
  if (state.assigned) tags.push({ key: "assigned", label: state.assigned === "me" ? tr("Assigned to me") : state.assigned === "unassigned" ? tr("Unassigned") : tr("Assigned"), clear: () => go({ assigned: null }) });
  if (state.batch) tags.push({ key: "batch", label: tr("Batch {batchLabel}", { batchLabel: batchLabel(state.batch) }), clear: () => go({ batch: null }) });
  if (state.due) tags.push({ key: "due", label: state.due === "overdue" ? tr("Overdue") : state.due === "week" ? tr("Due this week") : tr("Due soon"), clear: () => go({ due: null }) });
  if (state.policy) tags.push({ key: "policy", label: tr("Policy: {label}", { label: policyLabel(state.policy, packs) }), clear: () => go({ policy: null }) });
  if (state.system) tags.push({ key: "system", label: tr("System {name}", { name: landscape?.systems.find((x) => x.id === state.system)?.name ?? (state.system === "upload" ? tr("file uploads") : state.system) }), clear: () => go({ system: null }) });

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
            {tr("Clear filters")}
          </button>
        ) : (
          <V2Link href="/runs" className="m2-btn">
            {tr("Open the runs")}
          </V2Link>
        )
      }
    >
      {summary && summary.built === false
        ? tr("The work list of the latest run is not built yet, so no rows can be listed. It is built after each run finishes.")
        : state.chip === "approvals"
          ? tr("No value is waiting for approval. Accepted and entered values land here until a second person approves them.")
          : state.chip === "exceptions"
            ? tr("No record is signed off as not an issue or an accepted risk.")
            : tr("No rows in this view. Rows fill when an analysis finds a failing value with a fix; widen the view or clear its filters.")}
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
          <span className="m2-meta">{tr("{records} rows", { records: int(g.records) })}</span>
          <span className="m2-gx">
            {left > 0 ? (
              can.apply ? (
                <button type="button" className="m2-btn m2-sm" onClick={() => ask(left, tr("Accept {count} suggested values for {check}?", { count: int(left), check: g.check_id }), tr("Accept {count} values", { count: int(left) }), () => void actions.acceptRule(g.check_id, left, g.version_id, recordRows))}>
                  {tr("Accept all {left} suggested", { left: int(left) })}
                </button>
              ) : (
                <span className="m2-meta">{tr("{left} suggested", { left: int(left) })}</span>
              )
            ) : done ? (
              <span className="m2-meta">{tr("Suggested values accepted")}</span>
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
            <V2Link href={`${pathname}?${withState(search, state, { open: `batch:${b.id}` })}`} aria-label={tr("Open batch {label}", { label: b.label })}>
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
              <span className="m2-bh-meta">{b.status === "approved" ? (b.approvedBy ? tr("Approved by {approvedBy}", { approvedBy: b.approvedBy }) : tr("Approved")) : (b.owner ?? tr("No owner"))}</span>
              <span className="m2-bh-meta">{tr("{records} {records2, plural, one {record} other {records}}", { records: int(b.records), records2: b.records })}</span>
              <span className="m2-bh-meta">{b.valueAtRisk == null ? tr("no value at risk") : <>{money(b.valueAtRisk)}{" "}{tr("at risk")}</>}</span>
              <span className="m2-bh-meta">{b.dueAt ? tr("due {day}", { day: day(b.dueAt) }) : tr("no due date")}</span>
            </>
          )}
          <span className="m2-sr">{BATCH_STATUS_LABEL[b.status]}</span>
          <span className="m2-bh-x">
            <BatchButtons b={b} c={controls} />
            {b.status !== "draft" ? (
              <V2Link href={`${pathname}?${withState(search, { ...state, chip: null, batch: b.id, group: false })}`} className="m2-btn m2-sm">
                {tr("Show records")}
              </V2Link>
            ) : null}
          </span>
        </div>
      );
    }
    if (it.kind === "more") {
      return (
        <div className="m2-gb">
          <span className="m2-meta">{tr("{shown} of {total} rows of {check} shown", { shown: int(it.shown), total: int(it.total), check: it.check })}</span>
          <button type="button" className="m2-btn m2-sm" onClick={() => setExpanded((cur) => ({ ...(cur ?? openGroups), [it.check]: (cur ?? openGroups)[it.check] + GROUP_ROWS * 2 }))}>
            {tr("Show {min} more", { min: Math.min(GROUP_ROWS * 2, it.total - it.shown) })}
          </button>
        </div>
      );
    }
    return null;
  };

  const toolbar = (
    <div className="m2-tool" role="toolbar" aria-label={tr("Ledger controls")}>
      <div className="m2-seg" role="group" aria-label={tr("Grouping")}>
        <button type="button" aria-pressed={!grouped} onClick={() => go({ group: false })}>
          {tr("Flat")}
        </button>
        <button type="button" aria-pressed={grouped} disabled={!GROUPABLE.has(state.chip) || narrowed} title={narrowed ? tr("Grouping by rule does not apply to a policy class or a past run") : GROUPABLE.has(state.chip) ? undefined : tr("Grouping applies to rows to fix")} onClick={() => go({ group: true })}>
          {tr("By rule")}
        </button>
      </div>
      <label className="m2-selbox">
        <span className="m2-meta">{tr("Sort")}</span>
        <select className="m2-sel" aria-label={tr("Sort by")} value={state.sort} onChange={(e) => go({ sort: e.target.value as SortKey })}>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <option key={k} value={k}>
              {SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="m2-seg m2-only-wide" role="group" aria-label={tr("Row density")}>
        {(["compact", "comfortable"] as Density[]).map((d) => (
          <button key={d} type="button" aria-pressed={state.density === d} title={d === "compact" ? tr("Rows 28 pixels") : tr("Rows 32 pixels")} onClick={() => go({ density: d })}>
            {d === "compact" ? tr("Compact") : tr("Standard")}
          </button>
        ))}
      </div>
      <MenuButton label={tr("Views")} entries={viewEntries} className="m2-btn m2-sm">
        {tr("Views")}
        <Dot />
        {view?.name ?? tr("Unsaved")}
      </MenuButton>
      <label className="m2-selbox">
        <span className="m2-meta">{tr("Object")}</span>
        <select className="m2-sel" aria-label={tr("Object")} value={state.module ?? ""} onChange={(e) => go({ module: e.target.value || null })}>
          <option value="">{tr("All objects")}</option>
          {(summary?.objects ?? []).map((o) => (
            <option key={o.module} value={o.module}>
              {objectName(o.module, labels)}
            </option>
          ))}
        </select>
      </label>
      <label className="m2-selbox">
        <span className="m2-meta">{tr("As of run")}</span>
        <select className="m2-sel" aria-label={tr("As of run")} value={state.asOf ?? ""} onChange={(e) => go({ asOf: e.target.value || null, group: false })} data-testid="as-of-run">
          <option value="">{tr("Today")}</option>
          {(runList.data?.versions ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {formatDate(v.run_at, "datetime")}
            </option>
          ))}
        </select>
      </label>
      <span className="m2-tool-sp" />
      <button type="button" className="m2-btn m2-sm" disabled={narrowed} title={narrowed ? tr("The fix sheet reads today's rows without a policy or a past run; clear them to export") : undefined} onClick={() => void doExport()}>
        {tr("Export fix sheet")}{" "}<kbd className="m2-kb">e</kbd>
      </button>
      {can.apply ? (
        <button type="button" className="m2-btn m2-sm" aria-expanded={importOpen} onClick={() => setImportOpen((v) => !v)}>
          {tr("Import filled sheet")}
        </button>
      ) : null}
    </div>
  );

  const countText = grouped
    ? tr("{groupsCount} of {total} rules shown", { groupsCount: int(groups.length), total: int(groupsQ.data?.total ?? groups.length) })
    : total != null
      ? tr("Showing {min} of {total}{value}", { min: int(Math.min(shown, total)), total: int(total), value: rowsQ.data?.pages[0]?.total_capped ? tr(" or more") : "" })
      : "";
  const loadedNote = !grouped && SORTS_LOADED_ROWS.has(state.sort) && (hasMore || (total ?? 0) > shown) ? tr("Sorted by {SORT_LABEL} within the rows loaded.", { SORT_LABEL: SORT_LABEL[state.sort].toLowerCase() }) : "";

  return (
    <div onDragOver={(e) => can.apply && e.preventDefault()} onDrop={onDrop} data-testid="work-ledger">
      <PageTitle sub={objectLabel ?? tr("All objects")}>{tr("Work")}</PageTitle>
      {text ? (
        <p className="m2-finding" data-testid="work-sentence">
          {text}
        </p>
      ) : summaryQ.isPending ? (
        <p className="m2-finding" aria-busy="true">
          <Skeleton width={420} height={16} />
        </p>
      ) : null}
      <FixOrderHint module={state.module} />
      {state.asOf ? (
        <div className="m2-asof" role="status" data-testid="ledger-as-of">
          <span>
            <strong>{tr("As it stood at run {when}; statuses are today's.", { when: asOfRun ? formatDate(asOfRun.run_at, "datetime") : state.asOf.slice(0, 8) })}</strong>{" "}
            {tr("Each object is read at its newest run up to then. Counts on the chips are today's.")}
          </span>
          <button type="button" className="m2-btn m2-sm" onClick={() => go({ asOf: null })}>
            {tr("Back to today")}
          </button>
        </div>
      ) : null}
      <p className="m2-prov m2-only-wide">{tr("Rows are read from the latest run of each object{value}.", { value: status?.cost_model ? tr(". Value at risk is from cost model {cost_model}", { cost_model: status.cost_model }) : "" })}</p>
      {session.persona === "steward" && can.apply && topGroup && state.chip !== "approvals" && state.chip !== "exceptions" ? (
        <div className="m2-cta">
          <button type="button" className="m2-btn m2-next" onClick={() => ask(topGroup.proposed, tr("Accept {count} suggested values for {check}?", { count: int(topGroup.proposed), check: topGroup.check_id }), tr("Accept {count} values", { count: int(topGroup.proposed) }), () => void actions.acceptRule(topGroup.check_id, topGroup.proposed, topGroup.version_id, recordRows))}>
            {tr("Accept the {proposed} suggested {proposed2, plural, one {value} other {values}}", { proposed: int(topGroup.proposed), proposed2: topGroup.proposed })}
          </button>
          <span className="m2-meta m2-only-wide">
            {tr("for")}{" "}<Mono>{topGroup.check_id}</Mono>{tr(", the rule with the most at risk")}
          </span>
        </div>
      ) : session.persona === "steward" && can.apply && groupsQ.isPending ? (
        <div className="m2-cta" aria-busy="true">
          <Skeleton width={260} height={36} />
        </div>
      ) : null}
      <div className="m2-ledger-head">
        <Chips state={state} counts={counts} set={(chip) => go({ chip, group: chip === "approvals" || chip === "exceptions" ? false : state.group })} groupRef={chipsRef} policy={<PolicyChip value={state.policy} onChange={(policy) => go({ policy, group: false })} />} />
        {tags.length ? (
          <ul className="m2-tags" aria-label={tr("Filters in force")}>
            {tags.map((t) => (
              <li key={t.key}>
                <span>{t.label}</span>
                <button type="button" aria-label={tr("Remove filter: {label}", { label: t.label })} onClick={t.clear}>
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
              ? tr("Reading {name}…", { name: imp.name })
              : tr("Drop the filled fix sheet here, or choose a file (.xlsx). Meridian checks keys, SAP fields and values before anything changes.")}
          </span>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="m2-sr" aria-label={tr("Choose a filled fix sheet")} onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" className="m2-btn m2-sm" onClick={() => fileRef.current?.click()}>
            {tr("Choose file")}
          </button>
        </div>
      ) : null}
      {imp && !imp.busy ? (
        imp.error ? (
          <ErrorFrame>{imp.error}</ErrorFrame>
        ) : imp.result ? (
          <div className="m2-banner" role="status" data-testid="import-result">
            <p style={{ margin: 0 }}>
              {tr("{name}: {updated} {updated2, plural, one {decision} other {decisions}} saved from {rows} {rows2, plural, one {row} other {rows}}{value}.", { name: imp.name, updated: int(imp.result.updated), updated2: imp.result.updated, rows: int(imp.result.rows), rows2: imp.result.rows, value: imp.result.skipped.length ? tr("; {skippedCount} skipped", { skippedCount: int(imp.result.skipped.length) }) : "" })}
            </p>
            {imp.result.skipped.length ? (
              <ul className="m2-skipped">
                {imp.result.skipped.slice(0, 5).map((s) => (
                  <li key={s}>{s}</li>
                ))}
                {imp.result.skipped.length > 5 ? <li>{tr("and {count} more", { count: imp.result.skipped.length - 5 })}</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null
      ) : null}
      {state.batch && flatRows.some((r) => r.batch_id === undefined) ? (
        <div className="m2-banner" role="status" data-testid="batch-unfiltered">
          {tr("This list is not narrowed to the batch yet: the API does not send the batch of a row. The batch inspector lists its records.")}
        </div>
      ) : null}
      {sent ? (
        <ResultFrame outcome={sent}>
          <span>
            <button type="button" className="m2-btn m2-sm" onClick={() => setSent(null)}>
              {tr("Dismiss")}
            </button>
          </span>
        </ResultFrame>
      ) : null}
      <div className="m2-lcount" aria-live="polite">
        <span>{countText}</span>
        {loadedNote ? <span className="m2-meta m2-only-wide">{loadedNote}</span> : null}
        {hasMore ? (
          <button type="button" className="m2-btn m2-sm" disabled={rowsQ.isFetchingNextPage} onClick={() => void rowsQ.fetchNextPage()}>
            {tr("Show {PAGE} more", { PAGE })}
          </button>
        ) : null}
      </div>
      {phone ? (
        <LedgerList items={items} loading={loading} failed={failed} empty={empty} onRetry={() => void (grouped ? groupsQ.refetch() : rowsQ.refetch())} exceptions={state.chip === "exceptions"} headers={headers} openId={open?.kind === "record" ? open.id : null} onOpen={(row) => openItem({ kind: "record", id: recordItemId(row) })} spanRow={spanRow} />
      ) : (
        <Grid<Item>
          key={gridKey}
          id={COLUMNS_ID}
          toolbar={<GridTools gridId={COLUMNS_ID} route="work" title={tr("Work")} columns={columns} rows={items} filters={Object.fromEntries(Object.entries({ module: state.module, rule: state.rule, severity: state.severity, assigned: state.assigned }).filter(([, v]) => v)) as Record<string, string>} onColumns={bumpGrid} />}
          handleRef={gridHandle}
          ariaLabel={tr("Work ledger")}
          columns={columns}
          rows={items}
          rowId={itemId}
          compact={compact}
          height={560}
          selectable={can.apply || can.approve || can.assign}
          spanRow={spanRow}
          count={recordRows.length}
          bulkLabel={(n) => tr("{n} {n2, plural, one {record} other {records}}", { n: whole(n), n2: n })}
          loading={loading}
          error={failed ? <ErrorFrame onRetry={() => void (grouped ? groupsQ.refetch() : rowsQ.refetch())}>{tr("The rows to fix could not be read.")}</ErrorFrame> : undefined}
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
      {bulk ? (
        <div className="m2-bulkconfirm" data-testid="bulk-confirm" role="alertdialog" aria-label={tr("Confirm a change to {count} rows", { count: int(bulk.count) })}>
          <ConfirmBar
            message={<>{bulk.message} {tr("Enter confirms, Escape keeps the rows as they are.")}</>}
            confirmLabel={bulk.confirm}
            onConfirm={() => {
              const run = bulk.run;
              setBulk(null);
              run();
            }}
            onCancel={() => setBulk(null)}
          />
        </div>
      ) : null}
      {reason ? (
        <PromptDialog
          title={reason.kind === "not_an_issue" ? tr("Mark as not an issue") : tr("Accept the risk")}
          description={tr("{rowsCount} {rowsCount2, plural, one {record} other {records}} will leave the list of rows to fix and show under Exceptions.", { rowsCount: whole(reason.rows.length), rowsCount2: reason.rows.length })}
          label={tr("Reason")}
          confirm={reason.kind === "not_an_issue" ? tr("Mark as not an issue") : tr("Accept the risk")}
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
          title={tr("Save this view")}
          label={tr("Name")}
          confirm={tr("Save view")}
          description={tr("Keeps the filters, the grouping, the sort and the row density. Open it again from Views.")}
          onCancel={() => setSaving(false)}
          onConfirm={(name) => {
            setSaving(false);
            void viewsQ
              .save({ route: "work", name, filters: viewFilters(state), columns: null, density: state.density })
              .then((saved) => {
                toast.show(tr("Saved the view {name}", { name: saved.name }));
                goView(saved.id);
              })
              .catch((err) => toast.show(errorSentence(err, tr("The view could not be saved.")), "error"));
          }}
        />
      ) : null}
    </div>
  );
}

/** Phone: each row is two lines in a list; editing happens in the inspector. */
/** A record key as SAP shows it (ALPHA conversion), the full key in the title and in what is copied. */
function KeyText({ value }: { value: string }) {
  const shown = alphaOut(value);
  return (
    <span className="m2-mono" title={shown === value ? undefined : value} data-key={value}>
      {shown}
    </span>
  );
}

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
  if (failed) return <ErrorFrame onRetry={onRetry}>{tr("The rows to fix could not be read.")}</ErrorFrame>;
  if (loading) return <div aria-busy="true" className="m2-meta">{tr("Reading the rows to fix…")}</div>;
  if (items.length === 0) return <>{empty}</>;
  return (
    <div className="m2-mlist" role="list" aria-label={tr("Work ledger")}>
      {items.map((it) => {
        if (it.kind !== "row") return <div key={itemId(it)} role="listitem" className="m2-lgroup">{spanRow(it)}</div>;
        const r = it.row;
        const id = recordItemId(r);
        const d = daysOpen(r.first_seen_at);
        const second = keyValue(r, 1);
        return (
          <div key={id} role="listitem">
            <button type="button" className="m2-lrow" data-open={openId === id ? "true" : undefined} title={d != null ? tr("{d} days open", { d: int(d) }) : undefined} onClick={() => onOpen(r)}>
              <span className="m2-keyrule">
                <KeyText value={keyValue(r, 0) ?? r.record_key} />{" "}
                <span className="m2-mono m2-meta">{r.checks[0] ?? ""}</span>
              </span>
              <span className="m2-meta">{r.value_at_risk == null ? "—" : <Money amount={r.value_at_risk} compact={false} />}</span>
              <span className="m2-c m2-clip">
                {[r.name, second ? `${lc(headers.second)} ${second}` : null, `${r.top_message ?? ""}${r.current_value ? `: ${r.current_value}` : ""}${r.suggested_value ? tr(" to {suggested_value}", { suggested_value: r.suggested_value }) : ""}`, exceptions ? `${r.resolution === "accepted_risk" ? tr("Accept risk") : tr("Not an issue")}${r.resolution_note ? `: ${r.resolution_note}` : ""}${r.resolved_by ? `, ${r.resolved_by}` : ""}` : null].filter(Boolean).map((part, n) => (n === 0 ? <span key={n}>{part}</span> : <span key={n}><Dot />{part}</span>))}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
