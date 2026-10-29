"use client";

import { useSearchParams } from "next/navigation";
import { formatDate, systemTypeLabel } from "@/lib/format";
import type { SyncProfile } from "@/types/api";
import { useOpenItem } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemConfigLoad, useSystemExtractions, useSystemProfiles, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { HealthWord, protocolOf } from "../inspector/system";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { Fact, Facts } from "../Inspector";

export const SYSTEM_TABS = [
  { key: "overview", label: "Overview", old: "overview" },
  { key: "extractions", label: "Extractions", old: "runs" },
  { key: "configuration", label: "Configuration", old: "config" },
  { key: "schedules", label: "Schedules", old: "health" },
  { key: "custom-objects", label: "Custom objects", old: "custom" },
] as const;
type TabKey = (typeof SYSTEM_TABS)[number]["key"];

const WEEKDAY = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** A cron in words for the common shapes (daily, weekly), else the cron itself. Times are UTC, as the scheduler runs. */
export function describeCron(cron: string | null): string {
  if (!cron) return "No schedule";
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (![m, h, dom, mon, dow].every(Boolean) || !/^\d+$/.test(m) || !/^\d+$/.test(h) || dom !== "*" || mon !== "*") return cron;
  const at = `${h.padStart(2, "0")}:${m.padStart(2, "0")} UTC`;
  if (dow === "*") return `Every day at ${at}`;
  return /^\d$/.test(dow) ? `${WEEKDAY[Number(dow) % 7]} at ${at}` : cron;
}

function Handoff({ children, href, action }: { children: string; href: string; action: string }) {
  return (
    <div className="m2-handoff" data-testid="handoff">
      <p>{children}</p>
      <V2Link href={href} className="m2-btn">
        {action}
      </V2Link>
    </div>
  );
}

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
      <section className="m2-sec" style={{ marginTop: 0 }} aria-label="Objects">
        <div className="m2-sechead">
          <h2 className="m2-h2">Objects</h2>
          <span className="m2-sub">What the latest run scored</span>
        </div>
        {land.isLoading ? (
          <Skeleton width="100%" height={120} />
        ) : cells.length === 0 ? (
          <EmptyFrame>{system?.state === "extracted" ? "This system is extracted but no rule has run on it. Run an analysis." : "No object has a run on this system yet."}</EmptyFrame>
        ) : (
          <div className="m2-frame">
            <table className="m2-tbl" data-testid="system-objects">
              <thead>
                <tr>
                  <th scope="col">Object</th>
                  <th scope="col" className="m2-r">
                    Shown
                  </th>
                  <th scope="col">Verdict</th>
                  <th scope="col" className="m2-r">
                    Records checked
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
      <section className="m2-sec" aria-label="Recent jobs">
        <div className="m2-sechead">
          <h2 className="m2-h2">Recent jobs</h2>
          <span className="m2-sub">From the job registry</span>
        </div>
        {mine.length === 0 ? (
          <EmptyFrame>No job has run on this system in the last 7 days.</EmptyFrame>
        ) : (
          <div className="m2-frame">
            <table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">State</th>
                  <th scope="col">Started</th>
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
  if (q.isLoading) return <Skeleton width="100%" height={160} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>The extractions of this system could not be read.</ErrorFrame>;
  const versions = q.data?.versions ?? [];
  if (versions.length === 0) return <EmptyFrame>This system has not been extracted yet. Open the inspector and choose Extract.</EmptyFrame>;
  return (
    <div className="m2-frame">
      <table className="m2-tbl" data-testid="system-extractions">
        <thead>
          <tr>
            <th scope="col">Extracted</th>
            <th scope="col">Label</th>
            <th scope="col" className="m2-r">
              Objects
            </th>
            <th scope="col" className="m2-r">
              Records
            </th>
            <th scope="col">Analysis</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => {
            const records = Object.values(v.records).reduce((n, r) => n + r, 0);
            return (
              <tr key={v.id}>
                <th scope="row">{formatDate(v.run_at, "datetime")}</th>
                <td>
                  {v.baseline ? "Baseline" : null}
                  {v.baseline && v.label ? ", " : null}
                  {v.label ?? (v.baseline ? null : <Dash />)}
                </td>
                <td className="m2-r">{v.objects.length}</td>
                <td className="m2-r">{int(records)}</td>
                <td>
                  {v.analysed_at ? (
                    <V2Link href={`/v2/run/${v.id}`} className="m2-rowlink">
                      Open the run
                    </V2Link>
                  ) : (
                    <span className="m2-meta">{v.analysable ? "Not analysed" : "Cannot be analysed"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Configuration({ id }: { id: string }) {
  const q = useSystemConfigLoad(id);
  const c = q.data;
  return (
    <>
      {q.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>The configuration status could not be read.</ErrorFrame>
      ) : !c ? (
        <EmptyFrame>No configuration has been loaded from this system. Open the inspector and choose Load configuration.</EmptyFrame>
      ) : (
        <Facts>
          <Fact label="Status">{c.status === "completed" ? "Loaded" : c.status === "running" ? "Loading" : "Failed"}</Fact>
          <Fact label="Areas loaded">{`${c.areas_loaded} of ${c.areas_total}`}</Fact>
          <Fact label="Loaded">{c.finished_at ? formatDate(c.finished_at, "datetime") : "Still running"}</Fact>
          <Fact label="Objects">{Object.entries(c.summary).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || "—"}</Fact>
          <Fact label="Change history">{c.history.detail || "—"}</Fact>
        </Facts>
      )}
      <div style={{ marginTop: 16 }}>
        <Handoff href={`/systems/${id}?tab=config`} action="Open the configuration in the current interface">
          The configuration views, area by area with the objects behind each and the comparison with a target system, are still in the current interface. They arrive here in a later step.
        </Handoff>
      </div>
    </>
  );
}

function Schedules({ id }: { id: string }) {
  const q = useSystemProfiles(id);
  if (q.isLoading) return <Skeleton width="100%" height={120} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>The schedules could not be read.</ErrorFrame>;
  const profiles: SyncProfile[] = q.data ?? [];
  return (
    <>
      {profiles.length === 0 ? (
        <EmptyFrame>Nothing is scheduled for this system. A schedule extracts its objects on a timetable.</EmptyFrame>
      ) : (
        <div className="m2-frame">
          <table className="m2-tbl" data-testid="system-schedules">
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">Schedule</th>
                <th scope="col">Mode</th>
                <th scope="col">Next</th>
                <th scope="col">Last</th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.domain.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</th>
                  <td>{describeCron(p.schedule_cron)}</td>
                  <td>{p.extraction_mode === "delta" ? "Changes only" : "Full"}</td>
                  <td>{p.next_run_at ? formatDate(p.next_run_at, "datetime") : <Dash />}</td>
                  <td>{p.last_run_at ? formatDate(p.last_run_at, "datetime") : <Dash />}</td>
                  <td>{p.active ? "On" : "Off"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <Handoff href={`/systems/${id}?tab=health`} action="Edit schedules in the current interface">
          Adding, changing and pausing a schedule is still done in the current interface.
        </Handoff>
      </div>
    </>
  );
}

function CustomObjects({ id }: { id: string }) {
  return (
    <Handoff href={`/systems/${id}?tab=custom`} action="Open custom objects in the current interface">
      Custom Z objects, their profiles, dormant fields and anomalies are still in the current interface. They arrive here in a later step.
    </Handoff>
  );
}

/**
 * `/v2/s/{id}`: one system. Overview, Extractions, Configuration, Schedules and Custom objects as views of the one page
 * (`?tab=`). The heavy configuration and custom-object views hand over to the current interface, in a frame that says so.
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
        <PageTitle>System</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void land.refetch()}>The system could not be read.</ErrorFrame>
        </div>
      </>
    );
  }
  if (!land.isLoading && !system) {
    return (
      <>
        <PageTitle>System</PageTitle>
        <div className="m2-sec">
          <EmptyFrame action={<V2Link href="/v2" className="m2-btn">Back to the landscape</V2Link>}>This system is not in the tenant. It may have been removed.</EmptyFrame>
        </div>
      </>
    );
  }
  return (
    <>
      <PageTitle sub={system ? [system.version, system.client ? `client ${system.client}` : null].filter(Boolean).join(", ") : undefined}>{system?.name ?? "System"}</PageTitle>
      {system ? (
        <p className="m2-statusline" data-testid="system-status-line">
          <HealthWord health={ext?.health_status ?? system.health_status} />
          <span>{`${systemTypeLabel(system.system_type)}, ${protocolOf(system.system_type)}`}</span>
          <span>{system.last_extracted_at ? `Last extraction ${formatDate(system.last_extracted_at, "datetime")}` : "Never extracted"}</span>
          <span>{`${int(system.records)} records`}</span>
        </p>
      ) : (
        <Skeleton width={420} height={14} />
      )}
      {ext?.health_message ? <p className="m2-prov">{ext.health_message}</p> : null}
      <div className="m2-cta">
        <V2Link href={hrefFor({ kind: "system", id })} className="m2-btn m2-next">
          Test, load or extract
        </V2Link>
        <V2Link href={`/systems/${id}`} className="m2-btn">
          Open in the current interface
        </V2Link>
      </div>

      <nav className="m2-tabs" aria-label={`Views of ${system?.name ?? "the system"}`}>
        {SYSTEM_TABS.map((t) => (
          <V2Link key={t.key} href={href(t.key)} className="m2-tab" aria-current={t.key === tab ? "page" : undefined}>
            {t.label}
          </V2Link>
        ))}
      </nav>
      <div className="m2-tabpanel">
        {tab === "overview" ? <Overview id={id} /> : tab === "extractions" ? <Extractions id={id} /> : tab === "configuration" ? <Configuration id={id} /> : tab === "schedules" ? <Schedules id={id} /> : <CustomObjects id={id} />}
      </div>
    </>
  );
}
