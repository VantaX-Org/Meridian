"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate, labelOf } from "@/lib/format";
import { loadSystemConfig } from "@/lib/api/v2/runs";
import { discoverConfig, proposeConfigMatches } from "@/lib/api/v2/sys";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { areaFound, AREA_STATUS_WORD, objectSource, objectText, SOURCE_WORD } from "@/lib/v2/config-text";
import { useSystemConfigLoad, useSystemObjectList } from "@/lib/v2/runs-queries";
import { useConfigCompare, useConfigDrift, useRefreshV2, useSproConfig } from "@/lib/v2/sys-queries";
import { Fact, Facts } from "../../Inspector";
import { Field, Gate } from "../../forms";
import { useOutcome, ResultFrame } from "../../inspector/shared";
import { ScrollFrame } from "../object/ScrollFrame";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";
import { t as tr } from "@/lib/v2/i18n";

const PARTS = [
  { key: "areas", get label() { return tr("Areas"); } },
  { key: "source", get label() { return tr("Source"); } },
  { key: "drift", get label() { return tr("Drift log"); } },
  { key: "compare", get label() { return tr("Compare with target"); } },
] as const;
type Part = (typeof PARTS)[number]["key"];

function Areas({ id }: { id: string }) {
  const q = useSystemConfigLoad(id);
  const { hrefFor } = useOpenItem();
  if (q.isLoading) return <Skeleton width="100%" height={160} />;
  const areas = q.data?.areas ?? [];
  if (areas.length === 0) return <EmptyFrame>{tr("No configuration area has been read for this system. Load the configuration to see the areas and the objects behind each.")}</EmptyFrame>;
  return (
    <div data-testid="config-areas">
      {areas.map((a) => {
        const issues = a.objects.filter((o) => o.state === "failed" || o.cause);
        return (
          <div key={a.area} className="m2-area">
            <div className="m2-area-h">
              <V2Link href={hrefFor({ kind: "config", id: `${id}:${a.area}` })}>{a.label}</V2Link>
              <span className="m2-meta">{tr("{AREA_STATUS_WORD}, {tables_done} of {tables_total} objects", { AREA_STATUS_WORD: AREA_STATUS_WORD[a.status] ?? labelOf(a.status), tables_done: a.tables_done, tables_total: a.tables_total })}</span>
            </div>
            {a.status === "loaded" || a.status === "failed" ? <p>{areaFound(a)}</p> : null}
            {issues.map((o) => (
              <p key={o.object}>
                <Mono>{o.object}</Mono>
                {`: ${objectText(o)}`}
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Source({ id }: { id: string }) {
  const objects = useSystemObjectList(id);
  const load = useSystemConfigLoad(id);
  const mods = (objects.data?.objects ?? []).map((o) => o.object);
  const [module, setModule] = useState("");
  const chosen = module || mods[0] || "";
  const q = useSproConfig(id, chosen, Boolean(chosen));
  const objs = load.data?.areas.flatMap((a) => a.objects) ?? [];
  const live = objs.filter((o) => objectSource(o.state) === "live").length;
  return (
    <>
      <p className="m2-note" data-testid="config-source-summary">
        {objs.length === 0
          ? tr("No configuration has been loaded, so every rule reads the SAP standard baseline.")
          : tr("{live} of {objsCount} configuration objects were read live from the system; the other {count} fall back to the SAP standard baseline, and the rules that depend on them apply by default.", { live, objsCount: objs.length, count: objs.length - live })}
      </p>
      <div className="m2-form6" style={{ marginTop: 12 }}>
        <Field label={tr("Object")} hint={tr("The SPRO configuration the rules of this object read.")}>
          {(p) => (
            <select {...p} value={chosen} onChange={(e) => setModule(e.target.value)}>
              {mods.map((m) => (
                <option key={m} value={m}>{labelOf(m)}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {!chosen ? (
        <EmptyFrame>{tr("This system exposes no objects yet.")}</EmptyFrame>
      ) : q.isLoading ? (
        <Skeleton width="100%" height={100} />
      ) : q.isError ? (
        <EmptyFrame>{tr("No SPRO configuration is defined for this object, so its rules read the SAP standard baseline.")}</EmptyFrame>
      ) : q.data ? (
        <ScrollFrame label={tr("Table 1, scrollable")}  style={{ marginTop: 12 }}>
          <table className="m2-tbl" data-testid="spro-sources">
            <thead>
              <tr>
                <th scope="col">{tr("Table")}</th>
                <th scope="col">{tr("Source")}</th>
                <th scope="col" className="m2-r">{tr("Rows")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(q.data.table_sources).map(([t, src]) => (
                <tr key={t}>
                  <th scope="row"><Mono>{t}</Mono></th>
                  <td>{SOURCE_WORD[src] ?? labelOf(src)}</td>
                  <td className="m2-r">{(q.data.tables[t] ?? []).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      ) : null}
      {q.data ? <p className="m2-prov">{tr("Overall: {SOURCE_WORD}.", { SOURCE_WORD: SOURCE_WORD[q.data.source] ?? q.data.source })}</p> : null}
    </>
  );
}

function Drift() {
  const q = useConfigDrift();
  if (q.isLoading) return <Skeleton width="100%" height={120} />;
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isError && status !== 404) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("The drift log could not be read.")}</ErrorFrame>;
  const entries = q.data?.drift_entries ?? [];
  if (q.isError || entries.length === 0) return <EmptyFrame>{q.isError ? tr("The drift log needs two analysed runs to compare.") : tr("No configuration changed between the last two runs.")}</EmptyFrame>;
  return (
    <>
      <p className="m2-note">{tr("The log covers every connected system, between the last two runs.")}</p>
      <ScrollFrame label={tr("Table 2, scrollable")}>
        <table className="m2-tbl" data-testid="config-drift">
          <thead>
            <tr>
              <th scope="col">{tr("Module")}</th>
              <th scope="col">{tr("Element")}</th>
              <th scope="col">{tr("Change")}</th>
              <th scope="col">{tr("Before")}</th>
              <th scope="col">{tr("After")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={`${e.module}/${e.element_type}/${e.element_value}`}>
                <th scope="row">{labelOf(e.module)}</th>
                <td>{`${labelOf(e.element_type)} `}<Mono>{e.element_value}</Mono></td>
                <td>{labelOf(e.change_type)}</td>
                <td>{e.previous_value ?? <Dash />}</td>
                <td>{e.current_value ?? <Dash />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFrame>
    </>
  );
}

const MATCH_WORD: Record<string, string> = { get exists() { return tr("In target"); }, get key_match() { return tr("Key match"); }, get desc_match() { return tr("Description match"); }, get missing() { return tr("Missing"); } };

function Compare({ id }: { id: string }) {
  const [object, setObject] = useState<string | null>(null);
  const q = useConfigCompare(id, object);
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  if (q.isLoading) return <Skeleton width="100%" height={140} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("The comparison could not be read.")}</ErrorFrame>;
  const d = q.data;
  if (!d?.source_load_id) return <EmptyFrame>{tr("Nothing to compare yet. Load this system's configuration, then it is compared with its target.")}</EmptyFrame>;
  const propose = () =>
    void run("propose", async () => {
      const r = await proposeConfigMatches(id);
      refresh();
      return { tone: "ok", title: r.proposed ? tr("{proposed} {proposed, plural, one {match} other {matches}} sent to the steward queue", { proposed: r.proposed }) : tr("No new matches to propose"), detail: r.proposed ? tr("Target {target}. A steward decides each.", { target: r.target }) : undefined };
    });
  return (
    <>
      <p className="m2-note" data-testid="compare-target">{tr("Compared with {label}.", { label: d.target.label })}{d.target.baseline ? tr(" The target is the SAP standard baseline, so differences are flagged, not blocking.") : ""}</p>
      {d.objects.length === 0 ? (
        <EmptyFrame>{tr("The source and the target have no configuration object in common.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={tr("Table 3, scrollable")}>
          <table className="m2-tbl" data-testid="compare-objects">
            <thead>
              <tr>
                <th scope="col">{tr("Object")}</th>
                <th scope="col" className="m2-r">{tr("In target")}</th>
                <th scope="col" className="m2-r">{tr("Key match")}</th>
                <th scope="col" className="m2-r">{tr("Description match")}</th>
                <th scope="col" className="m2-r">{tr("Missing")}</th>
              </tr>
            </thead>
            <tbody>
              {d.objects.map((o) => (
                <tr key={o.object} aria-selected={object === o.object}>
                  <th scope="row">
                    <button type="button" className="m2-linkbtn m2-mono" aria-pressed={object === o.object} onClick={() => setObject(object === o.object ? null : o.object)}>
                      {o.object}
                    </button>
                  </th>
                  <td className="m2-r">{o.exists}</td>
                  <td className="m2-r">{o.key_match}</td>
                  <td className="m2-r">{o.desc_match}</td>
                  <td className="m2-r">{o.missing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      {object && d.rows.length > 0 ? (
        <ScrollFrame label={tr("Table 4, scrollable")}  style={{ marginTop: 12 }}>
          <table className="m2-tbl" aria-label={tr("Values of {object}", { object })}>
            <thead>
              <tr>
                <th scope="col">{tr("Value")}</th>
                <th scope="col">{tr("In target")}</th>
                <th scope="col">{tr("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.source_key}>
                  <th scope="row"><Mono>{r.source_key}</Mono></th>
                  <td>{r.target_key ? <Mono>{r.target_key}</Mono> : <Dash />}</td>
                  <td>{MATCH_WORD[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      ) : null}
      <div className="m2-acts" style={{ marginTop: 12 }}>
        <button type="button" className="m2-btn" disabled={!can("analyse") || pending !== null} onClick={propose}>
          {pending === "propose" ? tr("Proposing…") : tr("Propose matches")}
        </button>
      </div>
      {!can("analyse") ? <Gate>{tr("Proposing matches to the steward queue needs the analyse permission.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/**
 * System › Configuration: the SPRO and FO configuration of the system. Areas with the objects behind each (open one for
 * its rows and change history), where each object came from (live or the SAP baseline), the drift log and the
 * comparison with the target system.
 */
export function Configuration({ id }: { id: string }) {
  const params = useSearchParams();
  const part: Part = PARTS.find((p) => p.key === params.get("part"))?.key ?? "areas";
  const q = useSystemConfigLoad(id);
  const c = q.data;
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const href = (key: Part) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", "configuration");
    next.delete("open");
    if (key === "areas") next.delete("part");
    else next.set("part", key);
    return `/s/${id}?${next.toString()}`;
  };
  const load = () =>
    void run("load", async () => {
      const r = await loadSystemConfig(id);
      refresh();
      return { tone: "ok", title: tr("Configuration load started"), detail: tr("It reads the configuration tables of every area, then derives the flows. Read-only: Meridian never writes to SAP."), job: r.job_id };
    });
  const discover = () =>
    void run("discover", async () => {
      await discoverConfig(id);
      refresh();
      return { tone: "ok", title: tr("Discovery started"), detail: tr("It reruns configuration discovery on the latest stored data.") };
    });
  return (
    <>
      {q.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("The configuration status could not be read.")}</ErrorFrame>
      ) : !c ? (
        <EmptyFrame>{tr("No configuration has been loaded from this system. Choose Load configuration to read it.")}</EmptyFrame>
      ) : (
        <Facts>
          <Fact label={tr("Status")}>{c.status === "completed" ? tr("Loaded") : c.status === "running" ? tr("Loading") : tr("Failed")}</Fact>
          <Fact label={tr("Areas loaded")}>{tr("{areas_loaded} of {areas_total}", { areas_loaded: c.areas_loaded, areas_total: c.areas_total })}</Fact>
          <Fact label={tr("Loaded")}>{c.finished_at ? formatDate(c.finished_at, "datetime") : tr("Still running")}</Fact>
          <Fact label={tr("Objects")}>{Object.entries(c.summary).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || "—"}</Fact>
          <Fact label={tr("Change history")}>{c.history.detail || "—"}</Fact>
        </Facts>
      )}
      <div className="m2-acts" style={{ marginTop: 12 }}>
        <button type="button" className="m2-btn" disabled={!can("trigger_sync") || pending !== null} onClick={load}>
          {pending === "load" ? tr("Starting…") : c ? tr("Load again") : tr("Load configuration")}
        </button>
        <button type="button" className="m2-btn" disabled={!can("analyse") || pending !== null} onClick={discover}>
          {pending === "discover" ? tr("Starting…") : tr("Discover now")}
        </button>
      </div>
      {!can("trigger_sync") ? <Gate>{tr("Loading the configuration needs the trigger sync permission; discovery needs analyse.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <nav className="m2-subtabs" aria-label={tr("Configuration views")}>
        {PARTS.map((p) => (
          <V2Link key={p.key} href={href(p.key)} className="m2-seg" aria-current={p.key === part ? "page" : undefined}>
            {p.label}
          </V2Link>
        ))}
      </nav>
      {part === "areas" ? <Areas id={id} /> : part === "source" ? <Source id={id} /> : part === "drift" ? <Drift /> : <Compare id={id} />}
    </>
  );
}
