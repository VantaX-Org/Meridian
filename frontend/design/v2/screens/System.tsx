"use client";

import { useSearchParams } from "next/navigation";
import { formatDate, systemTypeLabel } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { describeCron } from "@/lib/v2/cron";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemExtractions, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { HealthWord, protocolOf } from "../inspector/system";
import { Configuration } from "./system/Configuration";
import { CustomObjects } from "./system/CustomObjects";
import { Schedules } from "./system/Schedules";
import { useState } from "react";
import { ChangeLog } from "./step9/ChangeLog";
import { ConfigChanges } from "./step9/Drift";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { t as tr } from "@/lib/v2/i18n";

export const SYSTEM_TABS = [
  { key: "overview", get label() { return tr("Overview"); }, old: "overview" },
  { key: "extractions", get label() { return tr("Extractions"); }, old: "runs" },
  { key: "configuration", get label() { return tr("Configuration"); }, old: "config" },
  { key: "changes", get label() { return tr("Configuration changes"); }, old: "changes" },
  { key: "schedules", get label() { return tr("Schedules"); }, old: "health" },
  { key: "custom-objects", get label() { return tr("Custom objects"); }, old: "custom" },
] as const;
type TabKey = (typeof SYSTEM_TABS)[number]["key"];

export { describeCron };

function Overview({ id }: { id: string }) {
  const land = useLandscape(null);
  const jobs = useV2Jobs();
  const L = land.data;
  const system = L?.systems.find((s) => s.id === id);
  const cells = (L?.cells ?? []).filter((c) => c.system_id === id);
  const mine = jobs.jobs.filter((j) => j.system_id === id).slice(0, 5);
  const { hrefFor } = useOpenItem();
  return (
    <>
      <section className="m2-sec" style={{ marginTop: 0 }} aria-label={tr("Objects")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{tr("Objects")}</h2>
          <span className="m2-sub">{tr("What the latest run scored")}</span>
        </div>
        {land.isLoading ? (
          <Skeleton width="100%" height={120} />
        ) : cells.length === 0 ? (
          <EmptyFrame>{system?.state === "extracted" ? tr("This system is extracted but no rule has run on it. Run an analysis.") : tr("No object has a run on this system yet.")}</EmptyFrame>
        ) : (
          <div className="m2-frame">
            <table className="m2-tbl" data-testid="system-objects">
              <thead>
                <tr>
                  <th scope="col">{tr("Object")}</th>
                  <th scope="col" className="m2-r">
                    {tr("Shown")}
                  </th>
                  <th scope="col">{tr("Verdict")}</th>
                  <th scope="col" className="m2-r">
                    {tr("Records checked")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {cells.map((c) => (
                  <tr key={c.module}>
                    <th scope="row">
                      <V2Link href={`/v2/o/${systemSlug(system?.name ?? "")}/${moduleSlug(c.module)}`}>{L?.objects.find((o) => o.module === c.module)?.label ?? c.module}</V2Link>
                    </th>
                    <td className="m2-r">{f1(c.score)}</td>
                    <td>
                      <span className="m2-v">
                        <VerdictMark verdict={c.verdict} />
                        {VERDICT_LABEL[c.verdict]}
                      </span>
                    </td>
                    <td className="m2-r">{int(c.records_checked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="m2-sec" aria-label={tr("Recent jobs")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{tr("Recent jobs")}</h2>
          <span className="m2-sub">{tr("From the job registry")}</span>
        </div>
        {mine.length === 0 ? (
          <EmptyFrame>{tr("No job has run on this system in the last 7 days.")}</EmptyFrame>
        ) : (
          <div className="m2-frame">
            <table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">{tr("Job")}</th>
                  <th scope="col">{tr("State")}</th>
                  <th scope="col">{tr("Started")}</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((j) => (
                  <tr key={j.id}>
                    <th scope="row">
                      <V2Link href={hrefFor({ kind: "job", id: j.id })}>{`${JOB_KIND_LABEL[j.kind]}, ${jobObject(j)}`}</V2Link>
                    </th>
                    <td>
                      <span className="m2-v">
                        {j.status === "completed" ? <VerdictMark verdict="go" /> : j.status === "failed" ? <VerdictMark verdict="no-go" /> : null}
                        {JOB_STATUS_LABEL[j.status]}
                      </span>
                    </td>
                    <td>{formatDate(j.started_at * 1000, "datetime")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Extractions({ id }: { id: string }) {
  const q = useSystemExtractions(id);
  const [shown, setShown] = useState<string | null>(null);
  if (q.isLoading) return <Skeleton width="100%" height={160} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{tr("The extractions of this system could not be read.")}</ErrorFrame>;
  const versions = q.data?.versions ?? [];
  if (versions.length === 0) return <EmptyFrame>{tr("This system has not been extracted yet. Open the inspector and choose Extract.")}</EmptyFrame>;
  const chosen = versions.find((v) => v.id === shown) ?? versions[0];
  return (
    <>
    <div className="m2-frame">
      <table className="m2-tbl" data-testid="system-extractions">
        <thead>
          <tr>
            <th scope="col">{tr("Extracted")}</th>
            <th scope="col">{tr("Label")}</th>
            <th scope="col" className="m2-r">
              {tr("Objects")}
            </th>
            <th scope="col" className="m2-r">
              {tr("Records")}
            </th>
            <th scope="col">{tr("Analysis")}</th>
            <th scope="col">
              <span className="m2-sr">{tr("Change log")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const records = Object.values(v.records).reduce((n, r) => n + r, 0);
            return (
              <tr key={v.id}>
                <th scope="row">{formatDate(v.run_at, "datetime")}</th>
                <td>
                  {v.baseline ? tr("Baseline") : null}
                  {v.baseline && v.label ? ", " : null}
                  {v.label ?? (v.baseline ? null : <Dash />)}
                </td>
                <td className="m2-r">{v.objects.length}</td>
                <td className="m2-r">{int(records)}</td>
                <td>
                  {v.analysed_at ? (
                    <V2Link href={`/v2/run/${v.id}`} className="m2-rowlink">
                      {tr("Open the run")}
                    </V2Link>
                  ) : (
                    <span className="m2-meta">{v.analysable ? tr("Not analysed") : tr("Cannot be analysed")}</span>
                  )}
                </td>
                <td>
                  <button type="button" className="m2-linkbtn" aria-pressed={chosen.id === v.id} aria-label={tr("Change log of the download of {when}", { when: formatDate(v.run_at, "datetime") })} onClick={() => setShown(v.id)}>
                    {tr("Change log")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <ChangeLog key={chosen.id} versionId={chosen.id} when={chosen.run_at} />
    </>
  );
}

/**
 * `/v2/s/{id}`: one system. Overview, Extractions, Configuration, Schedules and Custom objects as views of the one page
 * (`?tab=`). Configuration, Schedules and Custom objects are views of their own, with the verbs the viewer may use.
 */
export function SystemCanvas({ id }: { id: string }) {
  const params = useSearchParams();
  const { hrefFor } = useOpenItem();
  const land = useLandscape(null);
  const ext = useSystemsExtended().data?.find((s) => s.id === id);
  const system = land.data?.systems.find((s) => s.id === id);
  const tab: TabKey = SYSTEM_TABS.find((t) => t.key === params.get("tab"))?.key ?? "overview";
  const href = (key: TabKey) => {
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    const qs = next.toString();
    return qs ? `/v2/s/${id}?${qs}` : `/v2/s/${id}`;
  };

  if (land.isError) {
    return (
      <>
        <PageTitle>{tr("System")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void land.refetch()}>{tr("The system could not be read.")}</ErrorFrame>
        </div>
      </>
    );
  }
  if (!land.isLoading && !system) {
    return (
      <>
        <PageTitle>{tr("System")}</PageTitle>
        <div className="m2-sec">
          <EmptyFrame action={<V2Link href="/v2" className="m2-btn">{tr("Back to the landscape")}</V2Link>}>{tr("This system is not in the tenant. It may have been removed.")}</EmptyFrame>
        </div>
      </>
    );
  }
  return (
    <>
      <PageTitle sub={system ? [system.version, system.client ? tr("client {client}", { client: system.client }) : null].filter(Boolean).join(", ") : undefined}>{system?.name ?? tr("System")}</PageTitle>
      {system ? (
        <p className="m2-statusline" data-testid="system-status-line">
          <HealthWord health={ext?.health_status ?? system.health_status} />
          <span>{`${systemTypeLabel(system.system_type)}, ${protocolOf(system.system_type)}`}</span>
          <span>{system.last_extracted_at ? tr("Last extraction {last_extracted_at}", { last_extracted_at: formatDate(system.last_extracted_at, "datetime") }) : tr("Never extracted")}</span>
          <span>{tr("{records} records", { records: int(system.records) })}</span>
        </p>
      ) : (
        <Skeleton width={420} height={14} />
      )}
      {ext?.health_message ? <p className="m2-prov">{ext.health_message}</p> : null}
      <div className="m2-cta">
        <V2Link href={hrefFor({ kind: "system", id })} className="m2-btn m2-next">
          {tr("Test, load or extract")}
        </V2Link>
        <V2Link href={hrefFor({ kind: "connection", id })} className="m2-btn">
          {tr("Connection settings")}
        </V2Link>
      </div>

      <nav className="m2-tabs" aria-label={tr("Views of {name}", { name: system?.name ?? tr("the system") })}>
        {SYSTEM_TABS.map((t) => (
          <V2Link key={t.key} href={href(t.key)} className="m2-tab" aria-current={t.key === tab ? "page" : undefined}>
            {t.label}
          </V2Link>
        ))}
      </nav>
      <div className="m2-tabpanel">
        {tab === "overview" ? <Overview id={id} /> : tab === "extractions" ? <Extractions id={id} /> : tab === "configuration" ? <Configuration id={id} /> : tab === "changes" ? <ConfigChanges systemId={id} /> : tab === "schedules" ? <Schedules id={id} /> : <CustomObjects id={id} />}
      </div>
    </>
  );
}
