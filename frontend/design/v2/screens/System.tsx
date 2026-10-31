"use client";

import { useSearchParams } from "next/navigation";
import { formatDate, systemTypeLabel } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { describeCron } from "@/lib/v2/cron";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemExtractions, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { HealthWord, healthVerdict, protocolOf } from "../inspector/system";
import { labelText } from "@/lib/v2/labels";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Configuration } from "./system/Configuration";
import { CustomObjects } from "./system/CustomObjects";
import { Schedules } from "./system/Schedules";
import { useState, type ReactNode } from "react";
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
  const latest = useSystemExtractions(id).data?.versions[0];
  const bars = latest
    ? Object.entries(latest.records)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([module, n]) => ({ key: module, label: L?.objects.find((o) => o.module === module)?.label ?? labelText(module), value: n, text: int(n) }))
    : [];
  return (
    <>
      {latest && bars.length > 0 ? (
        <section className="m2-cc-card m2-cc-sysbars" aria-label={tr("Records per object")} data-testid="system-records-chart">
          <h3>{tr("Records per object")}</h3>
          <p className="m2-cc-lede">{tr("What the latest extraction, on {when}, read from each object.", { when: formatDate(latest.run_at, "datetime") })}</p>
          <CcHBars rows={bars} label={tr("Records per object in the latest extraction")} />
        </section>
      ) : null}
      <section className="m2-sec" aria-label={tr("Objects")}>
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
                      <V2Link href={`/o/${systemSlug(system?.name ?? "")}/${moduleSlug(c.module)}`}>{L?.objects.find((o) => o.module === c.module)?.label ?? c.module}</V2Link>
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
                    <V2Link href={`/run/${v.id}`} className="m2-rowlink">
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

/** The headline of the system: its connection, the latest extraction (running, failed or done), three figures and the one next step. */
function SystemBanner({ id, name, health, lastExtracted, scored, action }: { id: string; name: string; health: string | null; lastExtracted: string | null; scored: number; action: ReactNode }) {
  const jobs = useV2Jobs();
  const versions = useSystemExtractions(id).data?.versions ?? [];
  const job = jobs.jobs.filter((j) => j.system_id === id && j.kind === "extraction").sort((a, b) => b.started_at - a.started_at)[0];
  const running = job && (job.status === "queued" || job.status === "running");
  const failed = job?.status === "failed";
  const headline = running
    ? tr("An extraction from {name} is running, {pct}% done", { name, pct: Math.round(job.percent) })
    : failed
      ? tr("The latest extraction from {name} failed", { name })
      : health === "healthy"
        ? tr("{name} is connected", { name })
        : !health || health === "unknown"
          ? tr("The connection to {name} has not been tested yet", { name })
          : tr("The connection to {name} needs attention", { name });
  const when = lastExtracted ? tr("The last extraction was on {when}.", { when: formatDate(lastExtracted, "datetime") }) : tr("It has never been extracted.");
  return (
    <CcBanner
      testId="system-banner"
      label={tr("State of the system")}
      eyebrow={tr("State of the system")}
      verdict={running ? undefined : failed ? "no-go" : healthVerdict(health)}
      headline={headline}
      why={failed && job.error ? `${job.error} ${when}` : when}
      figs={[
        { label: tr("Objects extracted"), value: versions[0] ? int(versions[0].objects.length) : "—", note: tr("in the latest extraction") },
        { label: tr("Extractions kept"), value: int(versions.length), note: tr("to compare against") },
        { label: tr("Objects scored"), value: int(scored), note: tr("by the latest run") },
      ]}
      action={action}
    />
  );
}

/**
 * `/s/{id}`: one system. Overview, Extractions, Configuration, Schedules and Custom objects as views of the one page
 * (`?tab=`). Configuration, Schedules and Custom objects are views of their own, with the verbs the viewer may use.
 */
export function SystemCanvas({ id }: { id: string }) {
  const params = useSearchParams();
  const { hrefFor } = useOpenItem();
  const land = useLandscape(null);
  const ext = useSystemsExtended().data?.find((s) => s.id === id);
  const system = land.data?.systems.find((s) => s.id === id);
  // An old address names a tab by its old word (`?tab=config`, `?tab=health`): it opens the same view.
  const tab: TabKey = SYSTEM_TABS.find((t) => t.key === params.get("tab") || t.old === params.get("tab"))?.key ?? "overview";
  const href = (key: TabKey) => {
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    const qs = next.toString();
    return qs ? `/s/${id}?${qs}` : `/s/${id}`;
  };

  if (land.isError) {
    return (
      <CcPage>
        <PageTitle>{tr("System")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void land.refetch()}>{tr("The system could not be read.")}</ErrorFrame>
        </div>
      </CcPage>
    );
  }
  if (!land.isLoading && !system) {
    return (
      <CcPage>
        <PageTitle>{tr("System")}</PageTitle>
        <div className="m2-sec">
          <EmptyFrame action={<V2Link href="/" className="m2-btn">{tr("Back to the landscape")}</V2Link>}>{tr("This system is not in the tenant. It may have been removed.")}</EmptyFrame>
        </div>
      </CcPage>
    );
  }
  return (
    <CcPage>
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
      {system ? (
        <SystemBanner id={id} name={system.name} health={ext?.health_status ?? system.health_status} lastExtracted={system.last_extracted_at} scored={(land.data?.cells ?? []).filter((c) => c.system_id === id).length} action={
          <V2Link href={hrefFor({ kind: "system", id })} className="m2-btn m2-next">
            {tr("Test, load or extract")}
          </V2Link>
        } />
      ) : (
        <Skeleton width="100%" height={120} />
      )}
      <div className="m2-cta">
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
    </CcPage>
  );
}
