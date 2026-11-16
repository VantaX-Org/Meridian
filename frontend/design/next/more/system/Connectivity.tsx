"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { labelText, moduleText } from "@/lib/v2/labels";
import { describeField, describeTable } from "@/lib/v2/sap-fields";
import { downloadCsv, tableCsv } from "@/lib/v2/grid-export";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { extractModules, getConfigSnapshot, healthCheck, listSystemModules, syncConfig, type ConfigSnapshotTable, type SystemModule } from "@/lib/api/v2/connectivity";
import { getDesignConfig, getDesignCoverage, type DesignCoverageEntry } from "@/lib/api/v2/design";
import { Button, Chip, Code, Confirm, DataTable, SidePanel, useToast, type ChipTone, type Column } from "../../kit";
import { QueryView } from "../states";

type Ask = "config" | "extract";
type Cell = string | number | null;

const SHOWN = 20;
const cellText = (v: unknown): Cell => (v == null ? null : typeof v === "number" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
const rowsOf = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]).filter((r) => r && typeof r === "object") : []);
/** The column header of a pulled configuration field: its description beside the SAP name, when the description is known. */
const header = (table: string, key: string): string => {
  const d = describeField(`${table}.${key}`);
  return d ? `${d} (${key})` : key;
};

const COVERAGE: Record<string, { label: () => string; tone: ChipTone; next?: () => string }> = {
  live: { label: () => t("Read"), tone: "good" },
  failed: { label: () => t("Failed"), tone: "warn" },
  not_in_system: { label: () => t("Not in this system"), tone: "neutral" },
  delta_fallback: { label: () => t("Read in full, no delta"), tone: "good" },
  upload_required: { label: () => t("Upload required"), tone: "warn", next: () => t("This table cannot be read from the system. Upload it as a file; its rules wait until then.") },
  preview: { label: () => t("Preview source"), tone: "warn", next: () => t("This source is a preview: its connector is not yet verified against a live tenant, so its rules wait and are left out of the score.") },
  no_rule_mapping: { label: () => t("No rules read it"), tone: "neutral", next: () => t("Read, but no rule checks this table yet, so it adds nothing to the score.") },
  not_installed: { label: () => t("Not installed"), tone: "neutral", next: () => t("The component is not installed in this system, so its rules do not apply.") },
};

/** One pulled configuration table: what it is, how much was read, the first rows, and a CSV of the rows shown. */
function PulledTable({ table }: { table: ConfigSnapshotTable }) {
  const rows = rowsOf(table.data);
  const keys = Object.keys(rows[0] ?? {});
  const shown = rows.slice(0, SHOWN).map((r, i) => ({ ...r, __row: i }) as Record<string, unknown>);
  const cols: Column<Record<string, unknown>>[] = keys.map((k) => ({ id: k, label: header(table.table, k), cell: (r) => (r[k] == null ? "" : String(cellText(r[k]))) }));
  const exportCsv = () => downloadCsv(`config-${table.table}`, tableCsv(keys.map((k) => ({ key: k, header: header(table.table, k) })), shown.map((r) => Object.fromEntries(keys.map((k) => [k, cellText(r[k])])) as Record<string, Cell>)));
  return (
    <section className="nx-cell-stack" data-testid={`pulled-${table.table}`}>
      <h3 className="nx-rn-h3"><Code code={table.table} text={describeTable(table.table) ?? undefined} /></h3>
      <p className="nx-sub">
        {t("{records} records, source {source}, pulled {when}", {
          records: table.record_count == null ? t("Not counted") : int(table.record_count),
          source: table.source ?? t("Unknown"),
          when: table.synced_at ? formatDate(table.synced_at, "datetime") : t("Never"),
        })}
      </p>
      {shown.length ? (
        <>
          <DataTable rows={shown} columns={cols} rowKey={(r) => String(r.__row)} rowLabel={(r) => String(cellText(r[keys[0]]) ?? "")} caption={describeTable(table.table) ?? table.table} total={rows.length} />
          <div className="nx-row nx-wrap">
            <span className="nx-sub">{t("The first {shown} of {total} rows.", { shown: int(shown.length), total: int(rows.length) })}</span>
            <Button size={32} variant="quiet" icon="download" onClick={exportCsv}>{t("Export to CSV")}</Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function PulledConfigPanel({ id, module, onClose }: { id: string; module: string | null; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "connectivity", "config", fx, id, module ?? ""], queryFn: () => getConfigSnapshot(id, module as string), enabled: Boolean(module), retry: false });
  const tables = q.data?.tables ?? [];
  return (
    <SidePanel open={Boolean(module)} onClose={onClose} title={module ? t("Configuration of {module}", { module: moduleText(module) }) : ""}>
      {module ? (
        <div className="nx-cell-stack" data-testid="pulled-config">
          <QueryView loading={q.isLoading} error={q.error ? new Error(t("The pulled configuration could not be read.")) : null} onRetry={() => void q.refetch()} empty={tables.length === 0} emptyHeading={t("No configuration has been pulled for this module yet.")} label={t("Loading the pulled configuration")}>
            {tables.map((tb) => <PulledTable key={tb.table} table={tb} />)}
          </QueryView>
        </div>
      ) : null}
    </SidePanel>
  );
}

/** One configuration table as discovery stored it, opened from a coverage row. */
function DesignConfigPanel({ id, table, onClose }: { id: string; table: string | null; onClose: () => void }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "design", "config", fx, id, table ?? ""], queryFn: () => getDesignConfig(id, table as string), enabled: Boolean(table), retry: false });
  const d = q.data;
  const keys = useMemo(() => [...new Set((d?.rows ?? []).flatMap((r) => Object.keys(r)))], [d]);
  const cols: Column<Record<string, unknown>>[] = keys.map((k) => ({ id: k, label: header(table ?? "", k), cell: (r) => (r[k] == null ? "" : String(cellText(r[k]))) }));
  return (
    <SidePanel open={Boolean(table)} onClose={onClose} title={table ? describeTable(table) ?? table : ""}>
      {table ? (
        <div className="nx-cell-stack" data-testid="design-config">
          <span><Code code={table} text={describeTable(table) ?? undefined} /></span>
          <QueryView loading={q.isLoading} error={q.error ? new Error(errorSentence(q.error, t("No configuration was read for this table."))) : null} onRetry={() => void q.refetch()} empty={false} emptyHeading="" label={t("Loading the configuration table")}>
            {d ? (
              <>
                <dl className="nx-notes">
                  <dt>{t("Scope")}</dt><dd>{d.scope ? moduleText(d.scope) : t("Not set")}</dd>
                  <dt>{t("Entries")}</dt><dd>{d.total == null ? t("Not counted") : int(d.total)}</dd>
                  <dt>{t("Shown")}</dt><dd>{int(d.rows.length)}</dd>
                  <dt>{t("Read")}</dt><dd>{d.synced_at ? formatDate(d.synced_at, "datetime") : t("Never")}</dd>
                </dl>
                <DataTable rows={d.rows.map((r, i) => ({ ...r, __row: i }) as Record<string, unknown>)} columns={cols} rowKey={(r) => String(r.__row)} rowLabel={(r) => String(cellText(r[keys[0]]) ?? "")} caption={describeTable(table) ?? table} total={d.total ?? d.rows.length} empty={{ heading: t("The table has no stored entries.") }} />
              </>
            ) : null}
          </QueryView>
        </div>
      ) : null}
    </SidePanel>
  );
}

type CoverageRow = DesignCoverageEntry & { part: string; key: string };

/** What the last discovery tried to read, grouped by what it was read for, with the system's reason when it failed. */
function Coverage({ id }: { id: string }) {
  const fx = useFixture();
  const href = useV2Href();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["v2", "design", "coverage", fx, id], queryFn: () => getDesignCoverage(id), retry: false });
  const rows: CoverageRow[] = Object.entries(q.data?.coverage ?? {}).flatMap(([part, list]) => list.map((e, i) => ({ ...e, part, key: `${part}:${e.table ?? i}` })));
  const waiting = Object.entries(q.data?.waiting_for_data ?? {}).filter(([, n]) => n > 0);
  const cols: Column<CoverageRow>[] = [
    { id: "table", label: t("Table"), compare: (a, b) => (a.table ?? "").localeCompare(b.table ?? ""), cell: (r) => (r.table ? <Code code={r.table} text={describeTable(r.table) ?? r.purpose} /> : r.purpose ?? t("Unknown")) },
    { id: "part", label: t("Read for"), cell: (r) => labelText(r.part) },
    { id: "status", label: t("Outcome"), compare: (a, b) => a.status.localeCompare(b.status), cell: (r) => <Chip tone={COVERAGE[r.status]?.tone ?? "neutral"}>{COVERAGE[r.status]?.label() ?? labelText(r.status)}</Chip> },
    { id: "rows", label: t("Rows"), align: "end", compare: (a, b) => (a.rows ?? 0) - (b.rows ?? 0), cell: (r) => (r.rows == null ? "" : int(r.rows)) },
    {
      id: "detail", label: t("Detail"),
      cell: (r) => (
        <span className="nx-cell-stack">
          {r.detail ? <span>{r.detail}</span> : null}
          {COVERAGE[r.status]?.next ? <span className="nx-sub">{COVERAGE[r.status].next?.()}</span> : null}
          {r.status === "upload_required" ? <a className="nx-link" href={href("/admin/runs")}>{t("Upload a file")}</a> : null}
        </span>
      ),
    },
  ];
  return (
    <section className="nx-cell-stack" data-testid="design-coverage" aria-label={t("What the last discovery read")}>
      <h3 className="nx-rn-h3">{t("What the last discovery read")}</h3>
      <p className="nx-sub">{t("Every table the last discovery tried to read, grouped by what it was read for, with the outcome and the system's reason when it failed.")}</p>
      {waiting.map(([m, n]) => (
        <p key={m} className="nx-sub">{t("{module}: {count} {count, plural, one {rule waits} other {rules wait}} for data and {count, plural, one {is} other {are}} left out of the score.", { module: moduleText(m), count: n })}</p>
      ))}
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={q.data?.snapshot_id ? t("The last discovery stored no coverage.") : t("This system has not been discovered yet.")} label={t("Loading what the last discovery read")}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.key} rowLabel={(r) => r.table ?? r.part} caption={t("What the last discovery read")} onOpenRow={(r) => r.table && setOpen(r.table)} />
      </QueryView>
      <DesignConfigPanel id={id} table={open} onClose={() => setOpen(null)} />
    </section>
  );
}

/**
 * Connectivity of one system (api/routes/connectivity.py): its modules with their last read, a health check, a
 * configuration pull and a module extract (each needs trigger sync and a confirm), the configuration pulled per module,
 * and what the last design discovery read.
 */
export function Connectivity({ id }: { id: string }) {
  const fx = useFixture();
  const session = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const live = !session.shared && !session.viewAs;
  const canSync = session.can("trigger_sync") && live;
  const [ask, setAsk] = useState<{ kind: Ask; modules: string[] } | null>(null);
  const [config, setConfig] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["v2", "connectivity", "modules", fx, id], queryFn: () => listSystemModules(id), retry: false });
  const mods = q.data ?? [];
  const done = () => { void qc.invalidateQueries({ queryKey: ["v2"] }); void qc.invalidateQueries({ queryKey: ["jobs"] }); };
  const names = (list: string[]) => list.map(moduleText).join(", ");

  const health = useMutation({
    mutationFn: () => healthCheck(id),
    onSuccess: (r) => { toast({ text: `${t("Health check queued")}. ${t("The result shows under Health once the job finishes.")} ${t("Job {id}", { id: r.job_id })}`, tone: "good" }); done(); },
    onError: (e) => toast({ text: errorSentence(e, t("The health check could not start.")), tone: "bad" }),
  });
  const run = useMutation({
    mutationFn: (a: { kind: Ask; modules: string[] }) => (a.kind === "config" ? syncConfig(id, a.modules) : extractModules(id, a.modules)),
    onSuccess: (r, a) => {
      const text = a.kind === "config"
        ? `${t("Configuration pull queued")}. ${t("It reads the configuration of {modules} and stores it. No transactional data is read.", { modules: names(a.modules) })}`
        : `${t("Extraction queued")}. ${t("Data and configuration of {modules} are being read.", { modules: names(a.modules) })}`;
      toast({ text: `${text} ${t("Job {id}", { id: r.job_id })}`, tone: "good" });
      done();
    },
    onError: (e, a) => toast({ text: errorSentence(e, a.kind === "config" ? t("The configuration pull could not start.") : t("The extract could not start.")), tone: "bad" }),
  });

  const cols: Column<SystemModule>[] = [
    {
      id: "module", label: t("Module"), compare: (a, b) => a.module.localeCompare(b.module),
      cell: (m) => <span className="nx-cell-stack"><span>{moduleText(m.module)}</span><span className="nx-mono nx-sub">{m.module}</span></span>,
    },
    {
      id: "last", label: t("Last read"), compare: (a, b) => (a.last_synced_at ?? "").localeCompare(b.last_synced_at ?? ""),
      cell: (m) => (m.last_synced_at ? `${formatDate(m.last_synced_at, "datetime")}, ${labelText(m.last_sync_status)}` : t("Never")),
    },
    { id: "rows", label: t("Rows"), align: "end", compare: (a, b) => a.row_count - b.row_count, cell: (m) => int(m.row_count) },
    {
      id: "config", label: t("Configuration"),
      cell: (m) => (m.config_synced ? (
        <Button size={32} variant="quiet" aria-pressed={config === m.module} onClick={() => setConfig(config === m.module ? null : m.module)}>
          {config === m.module ? t("Hide configuration of {module}", { module: moduleText(m.module) }) : t("View configuration of {module}", { module: moduleText(m.module) })}
        </Button>
      ) : t("Not pulled")),
    },
    {
      id: "notes", label: t("Notes"),
      cell: (m) => (m.preview_sources.length ? (
        <span className="nx-cell-stack" data-testid={`preview-${m.module}`}>
          <span>{t("Preview: the names of {sources} are not yet verified against SAP.", { sources: m.preview_sources.map((p) => p.source).join(", ") })}</span>
          {m.preview_sources.map((p) => <span key={p.source}><Code code={p.source} text={p.reason} /></span>)}
        </span>
      ) : ""),
    },
  ];

  return (
    <div className="nx-body" data-testid="connectivity">
      <div className="nx-row nx-wrap">
        {canSync ? (
          <>
            <Button variant="secondary" icon="refresh" loading={health.isPending} loadingLabel={t("Queuing the health check")} onClick={() => health.mutate()} data-testid="connectivity-health">{t("Run a health check")}</Button>
            <p className="nx-sub">{t("Pick at least one module to pull configuration or run an extract.")}</p>
          </>
        ) : (
          <p className="nx-sub" data-testid="connectivity-denied">{t("Testing, loading and extracting need the trigger sync permission on this system.")}</p>
        )}
      </div>
      <QueryView loading={q.isLoading} error={q.error ? new Error(t("The modules of this system could not be read.")) : null} onRetry={() => void q.refetch()} empty={mods.length === 0} emptyHeading={t("This system type has no modules to read.")} label={t("Loading the modules")}>
        <DataTable
          rows={mods} columns={cols} rowKey={(m) => m.module} rowLabel={(m) => moduleText(m.module)} caption={t("Modules of this system")}
          selectable={canSync}
          bulkActions={(keys) => (
            <>
              <Button size={32} variant="secondary" disabled={run.isPending} onClick={() => setAsk({ kind: "config", modules: keys })} data-testid="connectivity-pull">{t("Pull configuration")}</Button>
              <Button size={32} variant="primary" disabled={run.isPending} onClick={() => setAsk({ kind: "extract", modules: keys })} data-testid="connectivity-extract">{t("Run extract")}</Button>
            </>
          )}
        />
      </QueryView>
      <Coverage id={id} />
      <PulledConfigPanel id={id} module={config} onClose={() => setConfig(null)} />
      <Confirm
        open={ask !== null}
        title={ask ? (ask.kind === "config" ? t("Pull configuration of {modules}", { modules: names(ask.modules) }) : t("Run an extract of {modules}", { modules: names(ask.modules) })) : ""}
        consequence={ask?.kind === "config"
          ? t("This connects to the system and reads the configuration tables of the picked modules. No transactional data is read.")
          : t("This connects to the system and reads data and configuration of the picked modules. A large extract can take a long time and load the system.")}
        confirmLabel={ask?.kind === "config" ? t("Pull configuration") : t("Run extract")}
        onConfirm={() => { if (ask && canSync) run.mutate(ask); setAsk(null); }}
        onCancel={() => setAsk(null)}
      />
    </div>
  );
}
