"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate, labelOf } from "@/lib/format";
import { loadSystemConfig } from "@/lib/api/v2/runs";
import { discoverConfig, proposeConfigMatches } from "@/lib/api/v2/sys";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { areaFound, AREA_STATUS_WORD, objectSource, objectText, SOURCE_WORD } from "@/lib/v2/config-text";
import { useSystemConfigLoad, useSystemObjectList } from "@/lib/v2/runs-queries";
import { useConfigCompare, useConfigDrift, useRefreshV2, useSproConfig } from "@/lib/v2/sys-queries";
import { describeTable } from "@/lib/v2/sap-fields";
import { DASH } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { useOutcome } from "@/design/v2/inspector/shared";
import { Result } from "./Result";
import { Button, Code, DataTable, EmptyState, ErrorState, SegmentedControl, Skeleton, type Column } from "../../kit";
import { ExportTable } from "../ExportTable";
import { Figs, Panel } from "../cfg-parts";

type Part = "areas" | "source" | "drift" | "compare";
const PARTS: Part[] = ["areas", "source", "drift", "compare"];

function Areas({ id }: { id: string }) {
  const q = useSystemConfigLoad(id);
  const { hrefFor } = useOpenItem();
  if (q.isLoading) return <Skeleton lines={4} label={t("Areas")} />;
  if (q.isError) return <ErrorState sentence={t("The configuration status could not be read.")} onRetry={() => void q.refetch()} />;
  const areas = q.data?.areas ?? [];
  if (areas.length === 0) return <EmptyState heading={t("No configuration area has been read for this system. Load the configuration to see the areas and the objects behind each.")} />;
  return (
    <ul className="nx-body" data-testid="config-areas">
      {areas.map((a) => {
        const issues = a.objects.filter((o) => o.state === "failed" || o.cause);
        return (
          <li key={a.area} className="nx-card nx-cell-stack">
            <span className="nx-row nx-wrap">
              <V2Link className="nx-link" href={hrefFor({ kind: "config", id: `${id}:${a.area}` })}>{a.label}</V2Link>
              <span className="nx-sub">{t("{AREA_STATUS_WORD}, {tables_done} of {tables_total} objects", { AREA_STATUS_WORD: AREA_STATUS_WORD[a.status] ?? labelOf(a.status), tables_done: a.tables_done, tables_total: a.tables_total })}</span>
            </span>
            {a.status === "loaded" || a.status === "failed" ? <span>{areaFound(a)}</span> : null}
            {issues.map((o) => (
              <span key={o.object}>
                <Code code={o.object} text={describeTable(o.object) ?? undefined} />
                {`: ${objectText(o)}`}
              </span>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function Source({ id }: { id: string }) {
  const objects = useSystemObjectList(id);
  const load = useSystemConfigLoad(id);
  const mods = (objects.data?.objects ?? []).map((o) => o.object);
  const [module, setModule] = useUrlParam<string>("module", "");
  const chosen = module || mods[0] || "";
  const q = useSproConfig(id, chosen, Boolean(chosen));
  const objs = load.data?.areas.flatMap((a) => a.objects) ?? [];
  const live = objs.filter((o) => objectSource(o.state) === "live").length;
  type Row = { table: string; src: string; rows: number };
  const rows: Row[] = q.data ? Object.entries(q.data.table_sources).map(([table, src]) => ({ table, src, rows: (q.data.tables[table] ?? []).length })) : [];
  const columns: Column<Row>[] = [
    { id: "table", label: t("Table"), cell: (r) => <Code code={r.table} text={describeTable(r.table) ?? undefined} /> },
    { id: "source", label: t("Source"), cell: (r) => SOURCE_WORD[r.src] ?? labelOf(r.src) },
    { id: "rows", label: t("Rows"), align: "end", cell: (r) => r.rows },
  ];
  return (
    <div className="nx-body">
      <p className="nx-note" data-testid="config-source-summary">
        {objs.length === 0
          ? t("No configuration has been loaded, so every rule reads the SAP standard baseline.")
          : t("{live} of {objsCount} configuration objects were read live from the system; the other {count} fall back to the SAP standard baseline, and the rules that depend on them apply by default.", { live, objsCount: objs.length, count: objs.length - live })}
      </p>
      <label className="nx-field">
        {t("Object")}
        <select className="nx-input" value={chosen} onChange={(e) => setModule(e.target.value)}>
          {mods.map((m) => <option key={m} value={m}>{labelOf(m)}</option>)}
        </select>
        <span className="nx-sub">{t("The SPRO configuration the rules of this object read.")}</span>
      </label>
      {objects.isLoading ? (
        <Skeleton lines={3} label={t("Source")} />
      ) : !chosen ? (
        <EmptyState heading={t("This system exposes no objects yet.")} />
      ) : q.isLoading ? (
        <Skeleton lines={3} label={t("Source")} />
      ) : q.isError ? (
        <EmptyState heading={t("No SPRO configuration is defined for this object, so its rules read the SAP standard baseline.")} />
      ) : q.data ? (
        <>
          <ExportTable>
            <div data-testid="spro-sources">
              <DataTable rows={rows} columns={columns} rowKey={(r) => r.table} rowLabel={(r) => r.table} caption={t("Source")} />
            </div>
          </ExportTable>
          <p className="nx-sub">{t("Overall: {SOURCE_WORD}.", { SOURCE_WORD: SOURCE_WORD[q.data.source] ?? q.data.source })}</p>
        </>
      ) : null}
    </div>
  );
}

function Drift() {
  const q = useConfigDrift();
  if (q.isLoading) return <Skeleton lines={4} label={t("Drift log")} />;
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isError && status !== 404) return <ErrorState sentence={t("The drift log could not be read.")} onRetry={() => void q.refetch()} />;
  const entries = q.data?.drift_entries ?? [];
  if (q.isError || entries.length === 0) return <EmptyState heading={q.isError ? t("The drift log needs two analysed runs to compare.") : t("No configuration changed between the last two runs.")} />;
  type Row = (typeof entries)[number];
  const columns: Column<Row>[] = [
    { id: "module", label: t("Module"), cell: (e) => labelOf(e.module) },
    { id: "element", label: t("Element"), cell: (e) => <Code code={e.element_value} text={labelOf(e.element_type)} /> },
    { id: "change", label: t("Change"), cell: (e) => labelOf(e.change_type) },
    { id: "before", label: t("Before"), cell: (e) => e.previous_value ?? DASH },
    { id: "after", label: t("After"), cell: (e) => e.current_value ?? DASH },
  ];
  return (
    <div className="nx-body">
      <p className="nx-note">{t("The log covers every connected system, between the last two runs.")}</p>
      <ExportTable>
        <div data-testid="config-drift">
          <DataTable rows={entries} columns={columns} rowKey={(e) => `${e.module}/${e.element_type}/${e.element_value}`} rowLabel={(e) => e.element_value} caption={t("Drift log")} />
        </div>
      </ExportTable>
    </div>
  );
}

const MATCH_WORD: Record<string, string> = { get exists() { return t("In target"); }, get key_match() { return t("Key match"); }, get desc_match() { return t("Description match"); }, get missing() { return t("Missing"); } };

function Compare({ id }: { id: string }) {
  const [object, setObject] = useState<string | null>(null);
  const q = useConfigCompare(id, object);
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  if (q.isLoading) return <Skeleton lines={4} label={t("Compare with target")} />;
  if (q.isError) return <ErrorState sentence={t("The comparison could not be read.")} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d?.source_load_id) return <EmptyState heading={t("Nothing to compare yet. Load this system's configuration, then it is compared with its target.")} />;
  const propose = () =>
    void run("propose", async () => {
      const r = await proposeConfigMatches(id);
      refresh();
      return { tone: "ok", title: r.proposed ? t("{proposed} {proposed, plural, one {match} other {matches}} sent to the steward queue", { proposed: r.proposed }) : t("No new matches to propose"), detail: r.proposed ? t("Target {target}. A steward decides each.", { target: r.target }) : undefined };
    });
  type Obj = (typeof d.objects)[number];
  type Val = (typeof d.rows)[number];
  const objColumns: Column<Obj>[] = [
    { id: "object", label: t("Object"), cell: (o) => (
      <button type="button" className="nx-link" aria-pressed={object === o.object} onClick={() => setObject(object === o.object ? null : o.object)}>
        <Code code={o.object} text={describeTable(o.object) ?? undefined} />
      </button>
    ) },
    { id: "exists", label: t("In target"), align: "end", cell: (o) => o.exists },
    { id: "key", label: t("Key match"), align: "end", cell: (o) => o.key_match },
    { id: "desc", label: t("Description match"), align: "end", cell: (o) => o.desc_match },
    { id: "missing", label: t("Missing"), align: "end", cell: (o) => o.missing },
  ];
  const valColumns: Column<Val>[] = [
    { id: "value", label: t("Value"), cell: (r) => <Code code={r.source_key} /> },
    { id: "target", label: t("In target"), cell: (r) => (r.target_key ? <Code code={r.target_key} /> : DASH) },
    { id: "status", label: t("Status"), cell: (r) => MATCH_WORD[r.status] ?? r.status },
  ];
  return (
    <div className="nx-body">
      <p className="nx-note" data-testid="compare-target">{t("Compared with {label}.", { label: d.target.label })}{d.target.baseline ? t(" The target is the SAP standard baseline, so differences are flagged, not blocking.") : ""}</p>
      {d.objects.length === 0 ? (
        <EmptyState heading={t("The source and the target have no configuration object in common.")} />
      ) : (
        <ExportTable>
          <div data-testid="compare-objects">
            <DataTable rows={d.objects} columns={objColumns} rowKey={(o) => o.object} rowLabel={(o) => o.object} caption={t("Compare with target")} />
          </div>
        </ExportTable>
      )}
      {object && d.rows.length > 0 ? (
        <ExportTable>
          <DataTable rows={d.rows} columns={valColumns} rowKey={(r) => r.source_key} rowLabel={(r) => r.source_key} caption={t("Values of {object}", { object })} />
        </ExportTable>
      ) : null}
      <div className="nx-row">
        <Button size={32} variant="secondary" disabled={!can("analyse") || pending !== null} loading={pending === "propose"} onClick={propose}>{t("Propose matches")}</Button>
      </div>
      {!can("analyse") ? <p className="nx-sub">{t("Proposing matches to the steward queue needs the analyse permission.")}</p> : null}
      {outcome ? <Result outcome={outcome} /> : null}
    </div>
  );
}

/**
 * System, Configuration: the SPRO and FO configuration of the system. Areas with the objects behind each (open one for
 * its rows and change history), where each object came from (live or the SAP baseline), the drift log and the
 * comparison with the target system.
 */
export function Configuration({ id }: { id: string }) {
  const params = useSearchParams();
  const [part, setPart] = useState<Part>(() => PARTS.find((p) => p === params.get("part")) ?? "areas");
  const q = useSystemConfigLoad(id);
  const c = q.data;
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const load = () =>
    void run("load", async () => {
      const r = await loadSystemConfig(id);
      refresh();
      return { tone: "ok", title: t("Configuration load started"), detail: t("It reads the configuration tables of every area, then derives the flows. Read-only: Meridian never writes to SAP."), job: r.job_id };
    });
  const discover = () =>
    void run("discover", async () => {
      await discoverConfig(id);
      refresh();
      return { tone: "ok", title: t("Discovery started"), detail: t("It reruns configuration discovery on the latest stored data.") };
    });
  return (
    <Panel title={t("Configuration")} testId="n-configuration">
      {q.isLoading ? (
        <Skeleton lines={3} label={t("Configuration")} />
      ) : q.isError ? (
        <ErrorState sentence={t("The configuration status could not be read.")} onRetry={() => void q.refetch()} />
      ) : !c ? (
        <EmptyState heading={t("No configuration has been loaded from this system. Choose Load configuration to read it.")} />
      ) : (
        <Figs label={t("Configuration")} figs={[
          { label: t("Status"), value: c.status === "completed" ? t("Loaded") : c.status === "running" ? t("Loading") : t("Failed") },
          { label: t("Areas loaded"), value: t("{areas_loaded} of {areas_total}", { areas_loaded: c.areas_loaded, areas_total: c.areas_total }) },
          { label: t("Loaded"), value: c.finished_at ? formatDate(c.finished_at, "datetime") : t("Still running") },
          { label: t("Objects"), value: Object.entries(c.summary).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || DASH },
          { label: t("Change history"), value: c.history.detail || DASH },
        ]} />
      )}
      <div className="nx-row nx-wrap">
        <Button size={32} variant="primary" disabled={!can("trigger_sync") || pending !== null} loading={pending === "load"} onClick={load}>{c ? t("Load again") : t("Load configuration")}</Button>
        <Button size={32} variant="secondary" disabled={!can("analyse") || pending !== null} loading={pending === "discover"} onClick={discover}>{t("Discover now")}</Button>
      </div>
      {!can("trigger_sync") ? <p className="nx-sub">{t("Loading the configuration needs the trigger sync permission; discovery needs analyse.")}</p> : null}
      {outcome ? <Result outcome={outcome} /> : null}
      <SegmentedControl label={t("Configuration views")} value={part} onChange={setPart} items={[
        { value: "areas", label: t("Areas") },
        { value: "source", label: t("Source") },
        { value: "drift", label: t("Drift log") },
        { value: "compare", label: t("Compare with target") },
      ]} />
      {part === "areas" ? <Areas id={id} /> : part === "source" ? <Source id={id} /> : part === "drift" ? <Drift /> : <Compare id={id} />}
    </Panel>
  );
}
