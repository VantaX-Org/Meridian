"use client";

import { useMemo, useState, type ComponentType } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { useLandscape } from "@/lib/v2/queries";
import { CHIPS, DEFAULT_STATE, STATUS_LABEL, filtersOf, ownerLabel, viewFilters, type ChipId } from "@/lib/v2/work";
import { allWorkRows, useWorkRows, useWorkSummary } from "@/lib/v2/work-queries";
import { hiddenColumns } from "@/lib/v2/grid-export";
import type { Landscape, WorkRow } from "@/lib/api/v2/types";
import { ProcessAnalytics } from "@/design/v2/screens/ProcessAnalytics";
import { RequestFormCanvas } from "@/design/v2/screens/RequestForm";
import { RequestsCanvas } from "@/design/v2/screens/Requests";
import { WorkCanvas } from "@/design/v2/screens/Work";
import { LegacyMount } from "../shell/LegacyMount";
import { MonitorBody } from "../screens/Monitor";
import { Button, Chip, Code, DataTable, EmptyState, SegmentedControl, Tabs, type Column, type TabItem } from "../kit";
import { StackedBar, type Seg } from "../viz";
import { WORK_SEGMENTS, segmentHref, segmentOf } from "./segments";
import { WorkBulkBar } from "./BulkBar";
import { WorkAnalytics } from "./Analytics";
import { WorkAttention } from "./Attention";
import { WorkTools } from "./Tools";
import { WorkApprovals } from "./Cleansing";
import { WorkDrafts } from "./Drafts";
import { WorkExceptions } from "./Exceptions";
import { WorkTriage } from "./Triage";
import "../shell/shell.css";
import "./work.css";

const SEVERITY_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "bad", medium: "warn", low: "neutral", info: "neutral" };
const rowId = (r: WorkRow) => `${r.module}|${r.record_key}|${r.version_id ?? ""}`;

/** The object page a record lives on: the system that holds its run, else the first system that has the object. */
export function workObjectHref(row: Pick<WorkRow, "module" | "version_id">, landscape: Landscape | undefined): string | null {
  if (!landscape) return null;
  const cell = landscape.cells.find((c) => c.module === row.module && c.run_id === row.version_id) ?? landscape.cells.find((c) => c.module === row.module);
  const sys = cell ? landscape.systems.find((s) => s.id === cell.system_id) : undefined;
  return sys ? `/next/o/${systemSlug(sys.name)}/${moduleSlug(row.module)}` : null;
}

// Native segments render as they are; the rest still mount the v2 screen until their native rebuild lands.
const SCREENS: Record<string, ComponentType> = {
  drafts: WorkDrafts,
  triage: WorkTriage,
  exceptions: WorkExceptions,
  analytics: WorkAnalytics,
  approvals: WorkApprovals,
};
const LEGACY: Record<string, ComponentType> = {
  requests: RequestsCanvas,
  "requests/new": RequestFormCanvas,
  "requests/analytics": ProcessAnalytics,
};

/** The ledger: every open record, one row each, with the state pills and the actions for a selection. */
export function Ledger() {
  const router = useRouter();
  const landscape = useLandscape(null).data;
  const summary = useWorkSummary().data;
  const [chip, setChip] = useState<ChipId>(DEFAULT_STATE.chip ?? "tofix");
  const [mine, setMine] = useState<"all" | "mine">("all");
  const [gen, setGen] = useState(0);
  const state = useMemo(() => ({ ...DEFAULT_STATE, chip, assigned: mine === "mine" ? "me" : null }), [chip, mine]);
  const q = useWorkRows(filtersOf(state), state.sort);
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  const total = q.data?.pages[0]?.total;
  const byId = useMemo(() => new Map(rows.map((r) => [rowId(r), r])), [rows]);

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

  // Saved views, a read-only share link and Export to Excel, as on the v2 Work grid: the columns on screen, every row of the state.
  const tools = cols.map((c) => ({ id: c.id, header: c.label, cell: c.cell }));
  const hidden = hiddenColumns("work-ledger", tools);
  const columns = cols.map((c) => ({ ...c, hidden: hidden.has(c.id) }));
  const TONES: Record<string, Seg["tone"]> = { tofix: "bad", approvals: "warn", approved: "chart1", sent: "chart3", fixed: "good", exceptions: "mute" };
  const segs: Seg[] = CHIPS.filter((c) => c.id in TONES).map((c) => ({ id: c.id, label: c.label, value: c.count(summary) ?? 0, tone: TONES[c.id] }));
  const flow = segs.reduce((a, x) => a + x.value, 0);
  return (
    <div className="nx-wk-ledger">
        <section className="nx-wk-viz" aria-label={t("Where the records stand")}>
          <StackedBar segs={segs} label={flow ? segs.map((x) => `${x.label} ${formatInt(x.value)}`).join(", ") : t("No record is counted yet")} />
          <small>{flow ? `${formatInt(flow)} ${t("{n, plural, one {record} other {records}}", { n: flow })}` : t("The bar fills as records are found.")}</small>
        </section>
        <div className="nx-wk-pills" role="group" aria-label={t("State")}>
          {CHIPS.map((c) => (
            <Chip key={c.id} tone="neutral" pressed={chip === c.id} count={c.count(summary) ?? undefined} onClick={() => setChip(c.id)}>
              {c.label}
            </Chip>
          ))}
          <SegmentedControl
            label={t("Whose work")}
            value={mine}
            onChange={setMine}
            items={[{ value: "all", label: t("Everyone") }, { value: "mine", label: t("Mine") }]}
          />
        </div>
        <div className="nx-wk-head">
          <p className="nx-wk-lede" aria-live="polite">
            {total != null ? `${formatInt(total)} ${t("{n, plural, one {record} other {records}}", { n: total })}` : ""}
          </p>
          <WorkTools gridId="work-ledger" route="work" title={t("Work")} columns={tools} rows={rows} filters={viewFilters(state)} allRows={() => allWorkRows(filtersOf(state), state.sort)} onColumns={() => setGen((g) => g + 1)} />
        </div>
        <DataTable<WorkRow>
          key={`${chip}-${mine}-${gen}`}
          rows={rows}
          columns={columns}
          rowKey={rowId}
          rowLabel={(r) => `${r.record_key} ${r.name ?? ""}`.trim()}
          caption={t("Records that need work")}
          total={total}
          selectable
          bulkActions={(keys) => <WorkBulkBar rows={keys.map((k) => byId.get(k)).filter((r): r is WorkRow => !!r)} onDone={() => setGen((g) => g + 1)} />}
          onOpenRow={(r) => {
            const href = workObjectHref(r, landscape);
            if (href) router.push(href);
          }}
          loading={q.isLoading}
          error={q.isError ? { sentence: t("The records could not be loaded."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("Nothing here"), text: t("No record is in this state right now.") }}
        />
        {q.hasNextPage ? (
          <div className="nx-wk-more">
            <Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>{t("Show more")}</Button>
          </div>
        ) : null}
    </div>
  );
}

function severityWord(s: string): string {
  switch (s) {
    case "critical": return t("Critical");
    case "high": return t("High");
    case "medium": return t("Medium");
    case "low": return t("Low");
    default: return t("Info");
  }
}

const NOT_FILTERS = new Set(["fixture", "role", "open"]);

/** Work: the ledger first, then the segments that decide what happens to it. */
export function Work({ slug }: { slug?: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  // A filtered address (?module=, ?rule=, ?filter=approvals, ?batch=, a saved ?view=, the old /fix and /inbox links)
  // opens the record ledger with its per-record decisions, new values and batch approvals. The demo's ?fixture= and
  // ?role= and the inspector's ?open= filter nothing, so they keep the Action centre and the ledger.
  const filtered = [...params.keys()].some((k) => !NOT_FILTERS.has(k));
  const hit = segmentOf(slug);
  const items: TabItem[] = WORK_SEGMENTS.map((s) => ({ id: s.id, label: s.label() }));
  const key = (slug ?? []).join("/");
  const Screen = hit && !hit.deep ? SCREENS[hit.id] : undefined;
  const Legacy = hit ? LEGACY[hit.deep ?? hit.id] : undefined;
  const go = (id: string) => {
    const s = WORK_SEGMENTS.find((x) => x.id === id);
    if (s) router.push(segmentHref(s));
  };
  const active = hit?.id ?? "ledger";
  return (
    <div className="nx-work">
      <header className="nx-strip">
        <h1>{t("Work")}</h1>
        <Tabs items={items} value={active} onChange={go} label={t("Work")} idBase="nx-work" />
      </header>
      <div id={`nx-work-panel-${active}`} role="tabpanel" data-segment={key}>
        {!hit ? (
          <EmptyState heading={t("Nothing at this address")} />
        ) : active === "ledger" && filtered ? (
          <LegacyMount><WorkCanvas /></LegacyMount>
        ) : active === "ledger" ? (
          <>
            <WorkAttention />
            <Ledger />
          </>
        ) : active === "monitor" ? (
          <MonitorBody />
        ) : Screen ? (
          <Screen />
        ) : Legacy ? (
          <LegacyMount><Legacy /></LegacyMount>
        ) : null}
      </div>
    </div>
  );
}
