"use client";

import { useState } from "react";
import { formatDate, labelOf } from "@/lib/format";
import { loadSystemConfig } from "@/lib/api/v2/runs";
import { AREA_STATUS_WORD, objectSource, objectText, SOURCE_WORD } from "@/lib/v2/config-text";
import { useV2Session } from "@/lib/v2/hooks";
import { useSystemConfigLoad } from "@/lib/v2/runs-queries";
import { useConfigItems, useRefreshV2 } from "@/lib/v2/sys-queries";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { Gate } from "../forms";
import { ScrollFrame } from "../screens/object/ScrollFrame";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "./shared";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

function Items({ system, object }: { system: string; object: string }) {
  const q = useConfigItems(system, object);
  if (q.isLoading) return <Skeleton width="100%" height={80} />;
  if (q.isError) return <p className="m2-rp m2-meta">{t("The rows of this object could not be read. They are stored with the last completed load.")}</p>;
  const items = q.data?.items ?? [];
  if (items.length === 0) return <p className="m2-rp m2-meta">{t("The last completed load stored no rows for this object.")}</p>;
  const cols = [...new Set(items.flatMap((i) => Object.keys(i.values)))].slice(0, 5);
  return (
    <ScrollFrame label={t("Rows, scrollable")}>
      <table className="m2-tbl" aria-label={t("Rows of {object}", { object })} data-testid="config-items">
        <thead>
          <tr>
            <th scope="col">{t("Key")}</th>
            {cols.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key}>
              <th scope="row"><Mono>{i.key}</Mono></th>
              {cols.map((c) => (
                <td key={c}>{i.values[c] == null ? <Dash /> : String(i.values[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollFrame>
  );
}

function Body({ system, area }: { system: string; area: string }) {
  const q = useSystemConfigLoad(system);
  const { can } = useV2Session();
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const [picked, setPicked] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton width="100%" height={140} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The configuration could not be read.")}</ErrorFrame>;
  const a = q.data?.areas.find((x) => x.area === area);
  if (!a) return <EmptyFrame>{t("This system has no configuration area with that name. Load the configuration to read the areas.")}</EmptyFrame>;
  const history = new Map((q.data?.objects ?? []).map((o) => [o.object, o.history]));
  const load = () =>
    void run("load", async () => {
      const r = await loadSystemConfig(system);
      refresh();
      return { tone: "ok", title: t("Configuration load started"), detail: t("Every area is read again."), job: r.job_id };
    });
  return (
    <>
      <Facts>
        <Fact label={t("Status")}>{AREA_STATUS_WORD[a.status] ?? labelOf(a.status)}</Fact>
        <Fact label={t("Objects read")}>{t("{tables_done} of {tables_total}", { tables_done: a.tables_done, tables_total: a.tables_total })}</Fact>
        <Fact label={t("Loaded")}>{q.data?.finished_at ? formatDate(q.data.finished_at, "datetime") : <Dash />}</Fact>
      </Facts>
      <h3>{t("Objects")}</h3>
      <ScrollFrame label={t("Table 1, scrollable")}>
        <table className="m2-tbl" data-testid="area-objects">
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              <th scope="col">{t("Source")}</th>
              <th scope="col" className="m2-r">{t("Rows")}</th>
              <th scope="col">{t("Last change")}</th>
            </tr>
          </thead>
          <tbody>
            {a.objects.map((o) => {
              const h = history.get(o.object);
              const readable = o.state === "loaded" && o.rows > 0;
              return (
                <tr key={o.object}>
                  <th scope="row">
                    {readable ? (
                      <button type="button" className="m2-linkbtn" aria-pressed={picked === o.object} onClick={() => setPicked(picked === o.object ? null : o.object)}>
                        <span className="m2-mono">{o.object}</span>
                        {o.label ? ` ${o.label}` : ""}
                      </button>
                    ) : (
                      <>
                        <Mono>{o.object}</Mono>
                        {o.label ? ` ${o.label}` : ""}
                      </>
                    )}
                    {o.state !== "loaded" ? <span className="m2-meta" style={{ display: "block" }}>{objectText(o)}</span> : null}
                  </th>
                  <td>{SOURCE_WORD[objectSource(o.state)]}</td>
                  <td className="m2-r">{int(o.rows)}</td>
                  <td>{h?.last_change ? `${h.last_change}${h.changes_in_window ? t(", {changes_in_window} in the window", { changes_in_window: h.changes_in_window }) : ""}` : <Dash />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollFrame>
      {picked ? (
        <>
          <h3>{t("Rows of {picked}", { picked })}</h3>
          <Items system={system} object={picked} />
        </>
      ) : (
        <p className="m2-prov">{t("Choose an object with rows to read them, as stored by the last completed load.")}</p>
      )}
      <Actions>
        <button type="button" className="m2-btn" disabled={!can("trigger_sync") || pending !== null} onClick={load}>
          {pending === "load" ? t("Starting…") : t("Load configuration again")}
        </button>
        <V2Link href={`/v2/s/${system}?tab=configuration&part=compare`} className="m2-btn">{t("Compare with the target")}</V2Link>
      </Actions>
      {!can("trigger_sync") ? <Gate>{t("Loading the configuration needs the trigger sync permission.")}</Gate> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/** `?open=config:<system>:<area>`: one configuration area, the objects behind it, where each came from, and their rows. */
export function ConfigInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const at = id.indexOf(":");
  const system = at > 0 ? id.slice(0, at) : "";
  const area = at > 0 ? id.slice(at + 1) : "";
  const q = useSystemConfigLoad(system, Boolean(system));
  const label = q.data?.areas.find((x) => x.area === area)?.label;
  return (
    <InspectorFrame title={label ?? labelOf(area) ?? t("Configuration area")} status={t("Configuration area")} onClose={onClose}>
      {system && area ? <Body system={system} area={area} /> : <EmptyFrame>{t("This address does not name a configuration area.")}</EmptyFrame>}
    </InspectorFrame>
  );
}
