"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ScopeKey } from "@/lib/api/system-objects";
import { formatDate, labelOf } from "@/lib/format";
import { analyseRun, extractObjects, loadSystemConfig, testSystemConnection } from "@/lib/api/v2/runs";
import { extractDelta, extractionDryRun, type DryRun } from "@/lib/api/v2/roles";
import type { LandscapeSystem } from "@/lib/api/v2/types";
import type { SAPSystemExtended } from "@/types/api";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { buildScope, dateError, EMPTY_SCOPE, SCOPE_LABEL, scopeSentence, type ScopeDraft } from "@/lib/v2/extract-scope";
import { useLandscape } from "@/lib/v2/queries";
import { notFound } from "@/lib/v2/roles-queries";
import { useSystemConfigLoad, useSystemExtractions, useSystemObjectList, useSystemsExtended } from "@/lib/v2/runs-queries";
import { describeTable } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { labelText, systemTypeText } from "@/lib/v2/labels";
import { V2Link } from "@/design/v2/parts";
import { RunForecast } from "@/design/v2/screens/step10/Prediction";
import { Connectivity } from "@/design/next/more/system/Connectivity";
import { Button, Code, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Field, HealthWord, Note, OutcomeLine, protocolOf, useOutcome } from "./objects-shared";

const STATE_WORD = (s: LandscapeSystem["state"]): string => ({ analysed: t("Analysed"), extracted: t("Extracted, not analysed"), not_extracted: t("Not extracted yet") })[s];

const duration = (s: number): string => (s < 90 ? t("{s} seconds", { s }) : s < 5400 ? t("{value} minutes", { value: Math.round(s / 60) }) : t("{value} hours", { value: (s / 3600).toFixed(1) }));

/** The extraction scope: the filters the chosen objects accept, the date window, and whether deleted records are skipped. */
function ScopeEditor({ draft, onChange, filters, windowed, windowObjects }: { draft: ScopeDraft; onChange: (d: ScopeDraft) => void; filters: ScopeKey[]; windowed: boolean; windowObjects: string[] }) {
  const err = dateError(draft.date_from, draft.date_to);
  return (
    <div className="nx-ob-form" data-testid="scope-editor">
      <h3>{t("Scope")}</h3>
      {filters.length === 0 && !windowed ? <Note>{t("The chosen objects accept no organisational filter. They are read in full.")}</Note> : null}
      <div className="nx-ob-grid">
        {filters.map((k) => (
          <Field key={k} label={SCOPE_LABEL[k]} hint={t("Comma-separated. Empty reads all.")}>
            {(p) => <input {...p} value={draft.lists[k] ?? ""} placeholder="1000, 2000" onChange={(e) => onChange({ ...draft, lists: { ...draft.lists, [k]: e.target.value } })} />}
          </Field>
        ))}
        {windowed ? (
          <>
            <Field label={t("Documents from")} hint={t("Replaces the default window for {map}", { map: windowObjects.map(labelOf).join(", ") })}>
              {(p) => <input {...p} type="date" value={draft.date_from} onChange={(e) => onChange({ ...draft, date_from: e.target.value })} />}
            </Field>
            <Field label={t("Documents to")} error={err}>
              {(p) => <input {...p} type="date" value={draft.date_to} onChange={(e) => onChange({ ...draft, date_to: e.target.value })} />}
            </Field>
          </>
        ) : null}
      </div>
      <label className="nx-ob-check">
        <input type="checkbox" checked={draft.exclude_deleted} onChange={(e) => onChange({ ...draft, exclude_deleted: e.target.checked })} />
        {t("Skip records flagged for deletion")}
      </label>
      <span className="nx-ob-hint">{t("Faster reads. Leave off for a full quality score, because inactive data is itself a finding.")}</span>
      <Note testId="scope-sentence">{scopeSentence(buildScope(draft, filters, windowed))}</Note>
    </div>
  );
}

/** What an extraction would read without reading it, and the delta extraction it offers. */
function DryRunBlock({ systemId, objects }: { systemId: string; objects: string[] }) {
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const [plan, setPlan] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const allowed = session.can("trigger_sync") && !session.shared && !session.viewAs;
  const dry = async () => {
    setBusy("dry");
    setError(null);
    try {
      setPlan(await extractionDryRun(systemId, objects));
    } catch (e) {
      setError(notFound(e) ? t("The dry run is not available on this server yet.") : failureText(e));
    } finally {
      setBusy(null);
    }
  };
  const delta = async () => {
    setBusy("delta");
    setError(null);
    try {
      const r = await extractDelta(systemId, objects, true);
      setStarted(r.job_id);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="nx-ib-sec" aria-label={t("Dry run")} data-testid="dry-run">
      <h3>{t("Dry run")}</h3>
      <Note>{t("What an extraction of {what} would read, without reading it.", { what: objects.length ? t("{objectsCount} {objectsCount, plural, one {object} other {objects}}", { objectsCount: objects.length }) : t("the chosen objects") })}</Note>
      <div>
        <Button size={32} disabled={!allowed || !objects.length || busy !== null} reason={!allowed ? t("Needs the trigger sync permission") : undefined} onClick={() => void dry()}>
          {busy === "dry" ? t("Counting…") : t("Dry run")}
        </Button>
      </div>
      {error ? (
        <p className="nx-ob-err" role="alert">
          {error}
        </p>
      ) : null}
      {plan ? (
        <div data-testid="dry-run-plan">
          <p>{t("{total_rows} rows in {tablesCount} {tablesCount, plural, one {table} other {tables}}, about {seconds} ({value}, {rate} rows a second).", { total_rows: int(plan.total_rows), tablesCount: plan.tables.length, seconds: duration(plan.seconds), value: plan.rate_basis === "measured" ? t("this system's recent speed") : t("an assumed speed"), rate: int(Math.round(plan.rate)) })}</p>
          {plan.unknown_tables ? <Note>{t("{unknown_tables} {unknown_tables, plural, one {table was} other {tables were}} never extracted, so their rows are not counted.", { unknown_tables: plan.unknown_tables })}</Note> : null}
          <div className="nx-ob-scroll">
            <table className="nx-ob-table">
              <thead>
                <tr>
                  <th scope="col">{t("Table")}</th>
                  <th scope="col" className="nx-ob-num">
                    {t("Rows last time")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.tables.map((row) => (
                  <tr key={row.table}>
                    <th scope="row">
                      <Code code={row.table} text={describeTable(row.table) ?? undefined} />
                    </th>
                    <td className="nx-ob-num">{row.rows === null ? <Dash why={t("Never extracted")} /> : int(row.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t("Changes only")}</h3>
          <Note id="dry-run-delta-why">{plan.delta.reason}</Note>
          <div>
            <Button size={32} disabled={!plan.delta.available || busy !== null} aria-describedby={plan.delta.available ? undefined : "dry-run-delta-why"} onClick={() => void delta()}>
              {busy === "delta" ? t("Starting…") : t("Extract changes only")}
            </Button>
          </div>
          {started ? (
            <p role="status">
              {t("Delta extraction queued ({job_id}).", { job_id: started })} <V2Link href={hrefFor({ kind: "job", id: started })}>{t("Open the job")}</V2Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExtractPicker({ system, allowAnalyse }: { system: LandscapeSystem; allowAnalyse: boolean }) {
  const qc = useQueryClient();
  const q = useSystemObjectList(system.id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [analyse, setAnalyse] = useState(allowAnalyse);
  const [delta, setDelta] = useState(false);
  const [scopeDraft, setScopeDraft] = useState<ScopeDraft>(EMPTY_SCOPE);
  const [label, setLabel] = useState("");
  const { outcome, pending, run } = useOutcome();
  const objects = q.data?.objects ?? [];
  const chosen = objects.filter((o) => picked.has(o.object));
  const filters = [...new Set(chosen.flatMap((o) => o.scope_filters))];
  const windowObjects = chosen.filter((o) => o.date_window.length > 0).map((o) => o.object);
  const scope = buildScope(scopeDraft, filters, windowObjects.length > 0);
  const badDates = Boolean(scopeDraft.date_from && scopeDraft.date_to && scopeDraft.date_to < scopeDraft.date_from);
  const toggle = (o: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(o)) n.delete(o);
      else n.add(o);
      return n;
    });
  const go = () =>
    void run("extract", async () => {
      const r = delta ? await extractObjects(system.id, [...picked], analyse, scope, label.trim() || undefined, true) : await extractObjects(system.id, [...picked], analyse, scope, label.trim() || undefined);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      return {
        tone: "ok",
        title: delta ? t("Extraction of changes started") : t("Extraction started"),
        detail: t("{size} {size, plural, one {object} other {objects}} from {name}{value}.", { size: picked.size, name: system.name, value: `${delta ? t(", changes only since the last full download") : ""}${analyse ? t(", analysed straight after") : ""}` }),
        job: r.job_id,
      };
    });
  return (
    <section className="nx-ib-sec" data-testid="extract-picker">
      <h3>{t("Objects to extract")}</h3>
      {q.isLoading ? (
        <Skeleton lines={3} />
      ) : q.isError ? (
        <ErrorState sentence={t("The objects of this system could not be read.")} onRetry={() => void q.refetch()} />
      ) : objects.length === 0 ? (
        <EmptyState heading={t("This system exposes no objects yet. Test the connection first.")} />
      ) : (
        <ul className="nx-ob-pick" aria-label={t("Objects to extract")}>
          {objects.map((o) => (
            <li key={o.object}>
              <label>
                <input type="checkbox" checked={picked.has(o.object)} onChange={() => toggle(o.object)} />
                <span>{labelText(o.object)}</span>
                <span className="nx-ib-meta">{o.last_download ? t("last {at}", { at: formatDate(o.last_download.at, "date") }) : t("never")}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {objects.length ? (
        <>
          <label className="nx-ob-check">
            <input type="checkbox" checked={analyse} disabled={!allowAnalyse} onChange={(e) => setAnalyse(e.target.checked)} />
            {t("Analyse straight after extracting")}
          </label>
          <label className="nx-ob-check">
            <input type="checkbox" checked={delta} onChange={(e) => setDelta(e.target.checked)} data-testid="extract-delta" />
            {t("Changes only since last full download")}
          </label>
          {delta ? <Note>{t("Only records whose SAP change date is after the last full download of the same objects and scope are read; tables without change dates are read in full. The change log of the download shows what changed, table by table, under Extractions.")}</Note> : null}
          {chosen.length > 0 ? (
            <>
              <ScopeEditor draft={scopeDraft} onChange={setScopeDraft} filters={filters} windowed={windowObjects.length > 0} windowObjects={windowObjects} />
              <Field label={t("Run label (optional)")}>{(p) => <input {...p} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}</Field>
            </>
          ) : (
            <Note>{t("Choose objects to set the scope: company codes, plants, organisations and a date window.")}</Note>
          )}
          {picked.size > 0 ? <RunForecast systemId={system.id} modules={[...picked]} delta={delta} what="extraction" /> : null}
          <div className="nx-ib-acts">
            <Button variant="primary" disabled={picked.size === 0 || pending !== null || badDates} onClick={go}>
              {pending === "extract" ? t("Starting…") : picked.size ? t("Extract {size} {size, plural, one {object} other {objects}}", { size: picked.size }) : t("Choose objects to extract")}
            </Button>
          </div>
          <DryRunBlock systemId={system.id} objects={[...picked]} />
        </>
      ) : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </section>
  );
}

function SystemBody({ system, ext }: { system: LandscapeSystem; ext: SAPSystemExtended | undefined }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const { outcome, pending, run } = useOutcome();
  const [picker, setPicker] = useState(false);
  const noConnection = Boolean(ext) && !ext?.host && !ext?.base_url;
  const config = useSystemConfigLoad(system.id);
  const extractions = useSystemExtractions(system.id);
  const sync = session.can("trigger_sync");
  const analyse = session.can("analyse");
  const protocol = protocolOf(system.system_type);
  const health = ext?.health_status ?? system.health_status;
  const pendingExtraction = extractions.data?.versions.find((v) => v.status === "extracted" && v.analysable);
  const canAnalyseNow = system.state === "extracted" && analyse;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["v2"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
  };

  const test = () =>
    void run("test", async () => {
      const r = await testSystemConnection(system.id);
      refresh();
      return { tone: r.connected ? "ok" : "fail", title: r.connected ? t("{protocol} connection works", { protocol }) : t("{protocol} connection failed", { protocol }), detail: r.message };
    });
  const loadConfig = () =>
    void run("config", async () => {
      const r = await loadSystemConfig(system.id);
      refresh();
      return { tone: "ok", title: t("Configuration load started"), detail: t("It reads the system's configuration tables, then derives the flows."), job: r.job_id };
    });
  const analyseNow = () =>
    void run("analyse", async () => {
      if (!pendingExtraction) return { tone: "fail", title: t("Nothing to analyse"), detail: t("No stored extraction of this system can be analysed.") };
      const r = await analyseRun(pendingExtraction.id);
      refresh();
      return { tone: "ok", title: t("Analysis started"), detail: t("The {run_at} extraction is being scored.", { run_at: formatDate(pendingExtraction.run_at, "datetime") }), job: r.job_id };
    });

  const loadState = config.data;
  return (
    <>
      <Note>
        <V2Link href={`/s/${system.id}`}>{t("Open the system")}</V2Link>
        {t(" for extractions, configuration, schedules and custom objects.")}
      </Note>
      <Facts>
        <Fact label={t("Health")}>
          <HealthWord health={health} />
        </Fact>
        <Fact label={protocol}>{ext?.health_message ?? t("No connection test on record")}</Fact>
        <Fact label={t("Type")}>{systemTypeText(system.system_type)}</Fact>
        <Fact label={t("Version")}>{system.version ?? <Dash />}</Fact>
        <Fact label={t("Client")}>{system.client ?? <Dash />}</Fact>
        <Fact label={t("State")}>{system.is_active === false ? t("Inactive") : STATE_WORD(system.state)}</Fact>
        <Fact label={t("Last extraction")}>{system.last_extracted_at ? formatDate(system.last_extracted_at, "datetime") : t("Never")}</Fact>
        <Fact label={t("Records")}>{int(system.records)}</Fact>
        <Fact label={t("Configuration")}>
          {config.isLoading ? "…" : loadState ? t("{areas_loaded} of {areas_total} areas, {value}", { areas_loaded: loadState.areas_loaded, areas_total: loadState.areas_total, value: loadState.finished_at ? formatDate(loadState.finished_at, "datetime") : t("running") }) : t("Not loaded")}
        </Fact>
      </Facts>

      {canAnalyseNow && pendingExtraction ? <RunForecast systemId={system.id} modules={pendingExtraction.objects} what="analysis" /> : null}
      <Actions>
        {canAnalyseNow ? (
          <Button variant="primary" disabled={pending !== null} onClick={analyseNow}>
            {pending === "analyse" ? t("Starting…") : t("Run analysis on {name}", { name: system.name })}
          </Button>
        ) : null}
        <Button disabled={!sync || pending !== null} onClick={test}>
          {pending === "test" ? t("Testing…") : t("Test connection")}
        </Button>
        <Button disabled={!sync || pending !== null} onClick={loadConfig}>
          {pending === "config" ? t("Starting…") : t("Load configuration")}
        </Button>
        <Button variant={system.state === "not_extracted" && !canAnalyseNow ? "primary" : "secondary"} aria-expanded={picker} aria-controls="nx-ob-extract" disabled={!sync} onClick={() => setPicker((v) => !v)}>
          {t("Extract")}
        </Button>
        <V2Link href={`/s/${system.id}?tab=schedules`} className="nx-btn nx-btn-secondary">
          {t("Schedule")}
        </V2Link>
        <V2Link href={hrefFor({ kind: "connection", id: system.id })} className={noConnection ? "nx-btn nx-btn-primary" : "nx-btn nx-btn-secondary"}>
          {t("Connection settings")}
        </V2Link>
      </Actions>
      {noConnection ? (
        <Note testId="no-connection">{t("This system has no connection settings yet, so there is nothing to extract from. Open the connection settings to enter the host or base URL and the credentials.")}</Note>
      ) : null}
      {!sync ? <Note>{t("Testing, loading and extracting need the trigger sync permission on this system.")}</Note> : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
      {picker ? (
        <div id="nx-ob-extract">
          <ExtractPicker system={system} allowAnalyse={analyse} />
        </div>
      ) : null}
      <Connectivity id={system.id} />
    </>
  );
}

/** `?open=system:<id>`: health, version, client, last extraction and the five actions, each answering in place. */
export function SystemInspector({ id, onClose }: BodyProps) {
  const landscape = useLandscape(null);
  const systems = useSystemsExtended();
  const system = landscape.data?.systems.find((s) => s.id === id);
  const ext = systems.data?.find((s) => s.id === id);
  const status = system ? [system.version, system.client ? t("client {client}", { client: system.client }) : null].filter(Boolean).join(", ") : landscape.isLoading ? "" : t("Not found in this tenant");
  return (
    <InspectorFrame title={system?.name ?? t("System")} status={status || undefined} onClose={onClose}>
      {system ? (
        <SystemBody system={system} ext={ext} />
      ) : landscape.isLoading ? (
        <Skeleton lines={4} />
      ) : landscape.isError ? (
        <ErrorState sentence={t("The system could not be read.")} onRetry={() => void landscape.refetch()} />
      ) : (
        <EmptyState heading={t("This system is not in the tenant. It may have been removed.")} />
      )}
    </InspectorFrame>
  );
}
