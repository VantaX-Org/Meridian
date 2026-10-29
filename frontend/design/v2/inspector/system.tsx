"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate, labelOf, systemTypeLabel } from "@/lib/format";
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

const ABAP = new Set(["ecc", "s4hana_onprem", "ewm"]);

/** The wire a system speaks, as the word the page uses: RFC for the ABAP systems, REST or OData for the cloud ones. */
export function protocolOf(type: string): "RFC" | "OData" | "REST" {
  return ABAP.has(type) ? "RFC" : type === "concur" || type === "ariba" ? "REST" : "OData";
}

const HEALTH_WORD: Record<string, string> = { healthy: "Connected", degraded: "Degraded", unreachable: "Unreachable", auth_failed: "Sign-in refused", unknown: "Not tested yet" };

export function healthVerdict(h: string | null | undefined): "go" | "at-risk" | "no-go" {
  return h === "healthy" ? "go" : h === "degraded" || h === "unknown" || !h ? "at-risk" : "no-go";
}

/** Health with a mark and a word, never colour alone. */
export function HealthWord({ health }: { health: string | null | undefined }) {
  return (
    <span className="m2-v">
      <VerdictMark verdict={healthVerdict(health)} />
      {HEALTH_WORD[health ?? "unknown"] ?? labelOf(health)}
    </span>
  );
}

const STATE_WORD: Record<LandscapeSystem["state"], string> = { analysed: "Analysed", extracted: "Extracted, not analysed", not_extracted: "Not extracted yet" };

function ExtractPicker({ system, allowAnalyse, onDone }: { system: LandscapeSystem; allowAnalyse: boolean; onDone: (o: { job: string; text: string }) => void }) {
  const qc = useQueryClient();
  const q = useSystemObjectList(system.id);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [analyse, setAnalyse] = useState(allowAnalyse);
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
      const r = await extractObjects(system.id, [...picked], analyse, scope, label.trim() || undefined);
      void qc.invalidateQueries({ queryKey: ["v2"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      onDone({ job: r.job_id, text: `${picked.size} ${picked.size === 1 ? "object" : "objects"}` });
      return { tone: "ok", title: "Extraction started", detail: `${picked.size} ${picked.size === 1 ? "object" : "objects"} from ${system.name}${analyse ? ", analysed straight after" : ""}.`, job: r.job_id };
    });
  return (
    <div data-testid="extract-picker">
      <h3>Objects to extract</h3>
      {q.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>The objects of this system could not be read.</ErrorFrame>
      ) : objects.length === 0 ? (
        <EmptyFrame>This system exposes no objects yet. Test the connection first.</EmptyFrame>
      ) : (
        <ul className="m2-pick" aria-label="Objects to extract">
          {objects.map((o) => (
            <li key={o.object}>
              <label>
                <input type="checkbox" checked={picked.has(o.object)} onChange={() => toggle(o.object)} />
                <span>{labelOf(o.object)}</span>
                <span className="m2-meta">{o.last_download ? `last ${formatDate(o.last_download.at, "date")}` : "never"}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {objects.length ? (
        <>
          <label className="m2-check">
            <input type="checkbox" checked={analyse} disabled={!allowAnalyse} onChange={(e) => setAnalyse(e.target.checked)} />
            Analyse straight after extracting
          </label>
          {chosen.length > 0 ? (
            <>
              <ScopeEditor draft={scopeDraft} onChange={setScopeDraft} filters={filters} windowed={windowObjects.length > 0} windowObjects={windowObjects} />
              <Field label="Run label (optional)">{(p) => <input {...p} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}</Field>
            </>
          ) : (
            <p className="m2-prov">Choose objects to set the scope: company codes, plants, organisations and a date window.</p>
          )}
          <div className="m2-acts" style={{ marginTop: 8 }}>
            <button type="button" className="m2-btn m2-strong" disabled={picked.size === 0 || pending !== null || Boolean(badDates)} onClick={go}>
              {pending === "extract" ? "Starting…" : picked.size ? `Extract ${picked.size} ${picked.size === 1 ? "object" : "objects"}` : "Choose objects to extract"}
            </button>
          </div>
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
      return { tone: r.connected ? "ok" : "fail", title: r.connected ? `${protocol} connection works` : `${protocol} connection failed`, detail: r.message };
    });
  const loadConfig = () =>
    void run("config", async () => {
      const r = await loadSystemConfig(system.id);
      refresh();
      return { tone: "ok", title: "Configuration load started", detail: "It reads the system's configuration tables, then derives the flows.", job: r.job_id };
    });
  const analyseNow = () =>
    void run("analyse", async () => {
      if (!pendingExtraction) return { tone: "fail", title: "Nothing to analyse", detail: "No stored extraction of this system can be analysed." };
      const r = await analyseRun(pendingExtraction.id);
      refresh();
      return { tone: "ok", title: "Analysis started", detail: `The ${formatDate(pendingExtraction.run_at, "datetime")} extraction is being scored.`, job: r.job_id };
    });

  const loadState = config.data;
  return (
    <>
      <Facts>
        <Fact label="Health">
          <HealthWord health={health} />
        </Fact>
        <Fact label={protocol}>{ext?.health_message ?? "No connection test on record"}</Fact>
        <Fact label="Type">{systemTypeLabel(system.system_type)}</Fact>
        <Fact label="Version">{system.version ?? "—"}</Fact>
        <Fact label="Client">{system.client ?? "—"}</Fact>
        <Fact label="State">{STATE_WORD[system.state]}</Fact>
        <Fact label="Last extraction">{system.last_extracted_at ? formatDate(system.last_extracted_at, "datetime") : "Never"}</Fact>
        <Fact label="Records">{int(system.records)}</Fact>
        <Fact label="Configuration">
          {config.isLoading ? "…" : loadState ? `${loadState.areas_loaded} of ${loadState.areas_total} areas, ${loadState.finished_at ? formatDate(loadState.finished_at, "datetime") : "running"}` : "Not loaded"}
        </Fact>
      </Facts>

      <Actions>
        {canAnalyseNow ? (
          <button type="button" className="m2-btn m2-next" disabled={pending !== null} onClick={analyseNow}>
            {pending === "analyse" ? "Starting…" : `Run analysis on ${system.name}`}
          </button>
        ) : null}
        <button type="button" className="m2-btn" disabled={!sync || pending !== null} onClick={test}>
          {pending === "test" ? "Testing…" : "Test connection"}
        </button>
        <button type="button" className="m2-btn" disabled={!sync || pending !== null} onClick={loadConfig}>
          {pending === "config" ? "Starting…" : "Load configuration"}
        </button>
        <button type="button" className={`m2-btn${system.state === "not_extracted" ? " m2-strong" : ""}`} aria-expanded={picker} aria-controls="m2-extract" disabled={!sync} onClick={() => setPicker((v) => !v)}>
          Extract
        </button>
        <V2Link href={`/v2/s/${system.id}?tab=schedules`} className="m2-btn">
          Schedule
        </V2Link>
        <V2Link href={hrefFor({ kind: "connection", id: system.id })} className={`m2-btn${noConnection ? " m2-strong" : ""}`}>
          Connection settings
        </V2Link>
      </Actions>
      {noConnection ? (
        <p className="m2-prov" data-testid="no-connection">
          This system has no connection settings yet, so there is nothing to extract from. Open the connection settings to enter the host or base URL and the credentials.
        </p>
      ) : null}
      {!sync ? <p className="m2-prov">Testing, loading and extracting need the trigger sync permission on this system.</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {picker ? (
        <div id="m2-extract">
          <ExtractPicker system={system} allowAnalyse={analyse} onDone={() => undefined} />
        </div>
      ) : null}
      <p className="m2-prov">
        <V2Link href={`/v2/s/${system.id}`}>Open the system</V2Link>
        {" for extractions, configuration, schedules and custom objects."}
      </p>
    </>
  );
}

/** `?open=system:<id>`: health, version, client, last extraction and the five actions, each answering in its own frame. */
export function SystemInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const landscape = useLandscape(null);
  const systems = useSystemsExtended();
  const system = landscape.data?.systems.find((s) => s.id === id);
  const ext = systems.data?.find((s) => s.id === id);
  const status = system ? [system.version, system.client ? `client ${system.client}` : null].filter(Boolean).join(", ") : landscape.isLoading ? "" : "Not found in this tenant";
  return (
    <InspectorFrame title={system?.name ?? "System"} status={status || undefined} onClose={onClose}>
      {system ? (
        <SystemBody system={system} ext={ext} />
      ) : landscape.isLoading ? (
        <Skeleton width="100%" height={120} />
      ) : landscape.isError ? (
        <ErrorFrame onRetry={() => void landscape.refetch()}>The system could not be read.</ErrorFrame>
      ) : (
        <EmptyFrame>This system is not in the tenant. It may have been removed.</EmptyFrame>
      )}
    </InspectorFrame>
  );
}
