"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { analyseRun, extractObjects, loadSystemConfig, testSystemConnection } from "@/lib/api/v2/runs";
import type { LandscapeSystem } from "@/lib/api/v2/types";
import type { SAPSystemExtended } from "@/types/api";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { buildScope, EMPTY_SCOPE, type ScopeDraft } from "@/lib/v2/extract-scope";
import { ScopeEditor } from "../screens/system/ScopeEditor";
import { Field } from "../forms";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemConfigLoad, useSystemExtractions, useSystemObjectList, useSystemsExtended } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { VerdictMark } from "../marks";
import { EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "./shared";
import { DryRunBlock } from "./governance";
import { t } from "@/lib/v2/i18n";
import { labelText, systemTypeText } from "@/lib/v2/labels";
import { RunForecast } from "../screens/step10/Prediction";

const ABAP = new Set(["ecc", "s4hana_onprem", "ewm"]);

/** The wire a system speaks, as the word the page uses: RFC for the ABAP systems, REST or OData for the cloud ones. */
export function protocolOf(type: string): "RFC" | "OData" | "REST" {
  return ABAP.has(type) ? "RFC" : type === "concur" || type === "ariba" ? "REST" : "OData";
}

const HEALTH_WORD: Record<string, string> = { get healthy() { return t("Connected"); }, get degraded() { return t("Degraded"); }, get unreachable() { return t("Unreachable"); }, get auth_failed() { return t("Sign-in refused"); }, get unknown() { return t("Not tested yet"); } };

export function healthVerdict(h: string | null | undefined): "go" | "at-risk" | "no-go" {
  return h === "healthy" ? "go" : h === "degraded" || h === "unknown" || !h ? "at-risk" : "no-go";
}

/** Health with a mark and a word, never colour alone. */
export function HealthWord({ health }: { health: string | null | undefined }) {
  return (
    <span className="m2-v">
      <VerdictMark verdict={healthVerdict(health)} />
      {HEALTH_WORD[health ?? "unknown"] ?? labelText(health)}
    </span>
  );
}

const STATE_WORD: Record<LandscapeSystem["state"], string> = { get analysed() { return t("Analysed"); }, get extracted() { return t("Extracted, not analysed"); }, get not_extracted() { return t("Not extracted yet"); } };

function ExtractPicker({ system, allowAnalyse, onDone }: { system: LandscapeSystem; allowAnalyse: boolean; onDone: (o: { job: string; text: string }) => void }) {
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
  const badDates = scopeDraft.date_from && scopeDraft.date_to && scopeDraft.date_to < scopeDraft.date_from;
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
      onDone({ job: r.job_id, text: t("{size} {size, plural, one {object} other {objects}}", { size: picked.size }) });
      return { tone: "ok", title: delta ? t("Extraction of changes started") : t("Extraction started"), detail: t("{size} {size, plural, one {object} other {objects}} from {name}{value}.", { size: picked.size, name: system.name, value: `${delta ? t(", changes only since the last full download") : ""}${analyse ? t(", analysed straight after") : ""}` }), job: r.job_id };
    });
  return (
    <div data-testid="extract-picker">
      <h3>{t("Objects to extract")}</h3>
      {q.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The objects of this system could not be read.")}</ErrorFrame>
      ) : objects.length === 0 ? (
        <EmptyFrame>{t("This system exposes no objects yet. Test the connection first.")}</EmptyFrame>
      ) : (
        <ul className="m2-pick" aria-label={t("Objects to extract")}>
          {objects.map((o) => (
            <li key={o.object}>
              <label>
                <input type="checkbox" checked={picked.has(o.object)} onChange={() => toggle(o.object)} />
                <span>{labelText(o.object)}</span>
                <span className="m2-meta">{o.last_download ? t("last {at}", { at: formatDate(o.last_download.at, "date") }) : "never"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {objects.length ? (
        <>
          <label className="m2-check">
            <input type="checkbox" checked={analyse} disabled={!allowAnalyse} onChange={(e) => setAnalyse(e.target.checked)} />
            {t("Analyse straight after extracting")}
          </label>
          <label className="m2-check">
            <input type="checkbox" checked={delta} onChange={(e) => setDelta(e.target.checked)} data-testid="extract-delta" />
            {t("Changes only since last full download")}
          </label>
          {delta ? <p className="m2-prov">{t("Only records whose SAP change date is after the last full download of the same objects and scope are read; tables without change dates are read in full. The change log of the download shows what changed, table by table, under Extractions.")}</p> : null}
          {chosen.length > 0 ? (
            <>
              <ScopeEditor draft={scopeDraft} onChange={setScopeDraft} filters={filters} windowed={windowObjects.length > 0} windowObjects={windowObjects} />
              <Field label={t("Run label (optional)")}>{(p) => <input {...p} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}</Field>
            </>
          ) : (
            <p className="m2-prov">{t("Choose objects to set the scope: company codes, plants, organisations and a date window.")}</p>
          )}
          {picked.size > 0 ? <RunForecast systemId={system.id} modules={[...picked]} delta={delta} what="extraction" /> : null}
          <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
            <button type="button" className="m2-btn m2-strong" disabled={picked.size === 0 || pending !== null || Boolean(badDates)} onClick={go}>
              {pending === "extract" ? t("Starting…") : picked.size ? t("Extract {size} {size, plural, one {object} other {objects}}", { size: picked.size }) : t("Choose objects to extract")}
            </button>
          </div>
          <DryRunBlock systemId={system.id} objects={[...picked]} />
        </>
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </div>
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
      <p className="m2-prov">
        <V2Link href={`/s/${system.id}`}>{t("Open the system")}</V2Link>
        {t(" for extractions, configuration, schedules and custom objects.")}
      </p>
      <Facts>
        <Fact label={t("Health")}>
          <HealthWord health={health} />
        </Fact>
        <Fact label={protocol}>{ext?.health_message ?? t("No connection test on record")}</Fact>
        <Fact label={t("Type")}>{systemTypeText(system.system_type)}</Fact>
        <Fact label={t("Version")}>{system.version ?? "—"}</Fact>
        <Fact label={t("Client")}>{system.client ?? "—"}</Fact>
        <Fact label={t("State")}>{STATE_WORD[system.state]}</Fact>
        <Fact label={t("Last extraction")}>{system.last_extracted_at ? formatDate(system.last_extracted_at, "datetime") : t("Never")}</Fact>
        <Fact label={t("Records")}>{int(system.records)}</Fact>
        <Fact label={t("Configuration")}>
          {config.isLoading ? "…" : loadState ? t("{areas_loaded} of {areas_total} areas, {value}", { areas_loaded: loadState.areas_loaded, areas_total: loadState.areas_total, value: loadState.finished_at ? formatDate(loadState.finished_at, "datetime") : "running" }) : t("Not loaded")}
        </Fact>
      </Facts>

      {canAnalyseNow && pendingExtraction ? <RunForecast systemId={system.id} modules={pendingExtraction.objects} what="analysis" /> : null}
      <Actions>
        {canAnalyseNow ? (
          <button type="button" className="m2-btn m2-next" disabled={pending !== null} onClick={analyseNow}>
            {pending === "analyse" ? t("Starting…") : t("Run analysis on {name}", { name: system.name })}
          </button>
        ) : null}
        <button type="button" className="m2-btn" disabled={!sync || pending !== null} onClick={test}>
          {pending === "test" ? t("Testing…") : t("Test connection")}
        </button>
        <button type="button" className="m2-btn" disabled={!sync || pending !== null} onClick={loadConfig}>
          {pending === "config" ? t("Starting…") : t("Load configuration")}
        </button>
        <button type="button" className={`m2-btn${system.state === "not_extracted" ? " m2-strong" : ""}`} aria-expanded={picker} aria-controls="m2-extract" disabled={!sync} onClick={() => setPicker((v) => !v)}>
          {t("Extract")}
        </button>
        <V2Link href={`/s/${system.id}?tab=schedules`} className="m2-btn">
          {t("Schedule")}
        </V2Link>
        <V2Link href={hrefFor({ kind: "connection", id: system.id })} className={`m2-btn${noConnection ? " m2-strong" : ""}`}>
          {t("Connection settings")}
        </V2Link>
      </Actions>
      {noConnection ? (
        <p className="m2-prov" data-testid="no-connection">
          {t("This system has no connection settings yet, so there is nothing to extract from. Open the connection settings to enter the host or base URL and the credentials.")}
        </p>
      ) : null}
      {!sync ? <p className="m2-prov">{t("Testing, loading and extracting need the trigger sync permission on this system.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {picker ? (
        <div id="m2-extract">
          <ExtractPicker system={system} allowAnalyse={analyse} onDone={() => undefined} />
        </div>
      ) : null}
    </>
  );
}

/** `?open=system:<id>`: health, version, client, last extraction and the five actions, each answering in its own frame. */
export function SystemInspector({ id, onClose }: { id: string; onClose: () => void }) {
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
        <Skeleton width="100%" height={120} />
      ) : landscape.isError ? (
        <ErrorFrame onRetry={() => void landscape.refetch()}>{t("The system could not be read.")}</ErrorFrame>
      ) : (
        <EmptyFrame>{t("This system is not in the tenant. It may have been removed.")}</EmptyFrame>
      )}
    </InspectorFrame>
  );
}
