"use client";

import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { formatDate, formatModuleName, systemTypeLabel } from "@/lib/format";
import { getSystemProfiles } from "@/lib/api/v2/runs";
import type { Landscape } from "@/lib/api/v2/types";
import type { Job } from "@/types/jobs";
import type { SAPSystemExtended, SyncProfile } from "@/types/api";
import { useFixture } from "@/lib/api/v2/fixture";
import { describeCron } from "@/lib/v2/cron";
import { useOpenItem } from "@/lib/v2/hooks";
import { firstSentence, JOB_KIND_LABEL, jobObject, openFailures } from "@/lib/v2/jobs";
import { runKeys, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { SeverityMark, VerdictMark } from "../marks";
import { ScrollFrame } from "./object/ScrollFrame";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";

/**
 * The SAP Basis home on the landscape: what a Basis or integration administrator looks after, from the reads the Runs
 * page and Administration already make. Connections and their health (GET /systems), the last extraction of each
 * system with its volume (the landscape's systems), the failed jobs still to triage and, among them and the health
 * checks, the authorisation errors (GET /jobs), and the extraction schedules (GET /systems/{id}/sync-profiles).
 */

/** A refusal SAP or the gateway answers for missing rights or credentials. */
const AUTH = /\b(401|403)\b|unauthori[sz]ed|not authori[sz]ed|authori[sz]ation|credential|S_TABU_DIS|S_RFC|RFC_NO_AUTHORITY|NO_AUTHORITY|logon|password/i;

export const isAuthError = (text: string | null | undefined): boolean => Boolean(text && AUTH.test(text));

function healthOf(status: SAPSystemExtended["health_status"]): { verdict: "go" | "at-risk" | "no-go" | null; word: string } {
  switch (status) {
    case "healthy":
      return { verdict: "go", word: t("Connected") };
    case "degraded":
      return { verdict: "at-risk", word: t("Degraded") };
    case "unreachable":
      return { verdict: "no-go", word: t("Unreachable") };
    case "auth_failed":
      return { verdict: "no-go", word: t("Refused the credentials") };
    default:
      return { verdict: null, word: t("Not checked yet") };
  }
}

function Block({ title, testid, children, note }: { title: string; testid: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="m2-sec" aria-label={title} data-testid={testid}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{title}</h2>
        {note ? <span className="m2-sub">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function BasisHome({ landscape }: { landscape: Landscape }) {
  const fixture = useFixture();
  const { hrefFor } = useOpenItem();
  const systemsQ = useSystemsExtended();
  const jobsQ = useV2Jobs();
  const systems = systemsQ.data ?? [];
  const profileQs = useQueries({ queries: systems.map((s) => ({ queryKey: runKeys.profiles(fixture, s.id), queryFn: () => getSystemProfiles(s.id), staleTime: 30_000 })) });
  const failed = openFailures(jobsQ.jobs);
  const nameOf = (id: string | null | undefined) => systems.find((s) => s.id === id)?.name ?? landscape.systems.find((s) => s.id === id)?.name ?? null;
  const authErrors: { where: string; what: string; at: string | null; href: string }[] = [
    ...systems.filter((s) => s.health_status === "auth_failed" || isAuthError(s.health_message)).map((s) => ({ where: s.name, what: s.health_message ?? t("Refused the credentials"), at: s.last_health_check, href: hrefFor({ kind: "system", id: s.id }) })),
    ...failed.filter((j) => isAuthError(j.error)).map((j: Job) => ({ where: nameOf(j.system_id) ?? jobObject(j), what: firstSentence(j.error), at: new Date((j.finished_at ?? j.updated_at) * 1000).toISOString(), href: hrefFor({ kind: "job", id: j.id }) })),
  ];
  const schedules: (SyncProfile & { systemName: string })[] = profileQs.flatMap((q, i) => (q.data ?? []).map((p) => ({ ...p, systemName: systems[i]?.name ?? "" })));

  return (
    <div data-testid="basis-home">
      <Block title={t("Connections")} testid="basis-connections" note={t("{count} {count, plural, one {system} other {systems}}", { count: systems.length })}>
        {systemsQ.isLoading ? (
          <Skeleton width="100%" height={96} />
        ) : systemsQ.isError ? (
          <ErrorFrame onRetry={() => void systemsQ.refetch()}>{t("The systems could not be read.")}</ErrorFrame>
        ) : systems.length === 0 ? (
          <EmptyFrame action={<V2Link href="/s/new" className="m2-btn">{t("Connect a system")}</V2Link>}>{t("No system is connected yet.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Connections table, scrollable")}>
            <table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">{t("System")}</th>
                  <th scope="col">{t("Type")}</th>
                  <th scope="col">{t("Connection")}</th>
                  <th scope="col">{t("Last check")}</th>
                  <th scope="col">{t("What it said")}</th>
                </tr>
              </thead>
              <tbody>
                {systems.map((s) => {
                  const h = healthOf(s.health_status);
                  return (
                    <tr key={s.id}>
                      <th scope="row"><V2Link href={hrefFor({ kind: "system", id: s.id })} className="m2-rowlink">{s.name}</V2Link></th>
                      <td>{systemTypeLabel(s.system_type)}{s.client ? <> <Mono>{s.client}</Mono></> : null}</td>
                      <td><span className="m2-v">{h.verdict ? <VerdictMark verdict={h.verdict} /> : null}{h.word}</span></td>
                      <td>{s.last_health_check ? formatDate(s.last_health_check, "datetime") : <Dash why={t("No connection test has run")} />}</td>
                      <td>{s.health_message ?? <Dash />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Block>

      <Block title={t("Last extraction")} testid="basis-extractions">
        <ScrollFrame label={t("Extractions table, scrollable")}>
          <table className="m2-tbl">
            <thead>
              <tr>
                <th scope="col">{t("System")}</th>
                <th scope="col">{t("Last extraction")}</th>
                <th scope="col" className="m2-r">{t("Records")}</th>
                <th scope="col">{t("State")}</th>
              </tr>
            </thead>
            <tbody>
              {landscape.systems.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.name}</th>
                  <td>{s.last_extracted_at ? formatDate(s.last_extracted_at, "datetime") : <Dash why={t("Never extracted")} />}</td>
                  <td className="m2-r">{s.records == null ? <Dash why={t("Never extracted")} /> : int(s.records)}</td>
                  <td>{s.state === "analysed" ? t("Analysed") : s.state === "extracted" ? t("Extracted, not analysed") : t("Not extracted")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      </Block>

      <Block title={t("Failed jobs to triage")} testid="basis-failures" note={t("{count} open", { count: failed.length })}>
        {jobsQ.isLoading ? (
          <Skeleton width="100%" height={64} />
        ) : failed.length === 0 ? (
          <EmptyFrame>{t("No failed job is waiting. A job that fails and is not followed by a success of the same kind lands here.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Failed jobs table, scrollable")}>
            <table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">{t("Job")}</th>
                  <th scope="col">{t("System")}</th>
                  <th scope="col">{t("Failed")}</th>
                  <th scope="col">{t("Why")}</th>
                </tr>
              </thead>
              <tbody>
                {failed.map((j) => (
                  <tr key={j.id}>
                    <th scope="row">
                      <span className="m2-v"><SeverityMark severity="critical" /><V2Link href={hrefFor({ kind: "job", id: j.id })} className="m2-rowlink">{t("{JOB_KIND_LABEL} of {jobObject}", { JOB_KIND_LABEL: JOB_KIND_LABEL[j.kind], jobObject: jobObject(j) })}</V2Link></span>
                    </th>
                    <td>{nameOf(j.system_id) ?? <Dash />}</td>
                    <td>{formatDate(new Date((j.finished_at ?? j.updated_at) * 1000).toISOString(), "datetime")}</td>
                    <td>{firstSentence(j.error) || <Dash />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Block>

      <Block title={t("Authorisation errors")} testid="basis-auth">
        {authErrors.length === 0 ? (
          <EmptyFrame>{t("No refused credentials or missing authorisations in the connection tests and the jobs read.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Authorisation errors table, scrollable")}>
            <table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">{t("Where")}</th>
                  <th scope="col">{t("When")}</th>
                  <th scope="col">{t("What SAP answered")}</th>
                </tr>
              </thead>
              <tbody>
                {authErrors.map((a, i) => (
                  <tr key={i}>
                    <th scope="row"><V2Link href={a.href} className="m2-rowlink">{a.where}</V2Link></th>
                    <td>{a.at ? formatDate(a.at, "datetime") : <Dash />}</td>
                    <td>{a.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Block>

      <Block title={t("Schedules")} testid="basis-schedules">
        {schedules.length === 0 ? (
          <EmptyFrame action={<V2Link href="/admin/runs" className="m2-btn">{t("Start and schedule")}</V2Link>}>{t("No extraction is scheduled.")}</EmptyFrame>
        ) : (
          <ScrollFrame label={t("Schedules table, scrollable")}>
            <table className="m2-tbl">
              <thead>
                <tr>
                  <th scope="col">{t("System")}</th>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("When")}</th>
                  <th scope="col">{t("Next run")}</th>
                  <th scope="col">{t("Mode")}</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">{p.systemName}</th>
                    <td>{landscape.objects.find((o) => o.module === p.domain)?.label ?? formatModuleName(p.domain)}</td>
                    <td>{p.active && p.schedule_cron ? describeCron(p.schedule_cron) : t("Not scheduled")}</td>
                    <td>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : <Dash why={t("Not scheduled")} />}</td>
                    <td>{p.extraction_mode === "delta" ? t("Changes only") : t("Full")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Block>
    </div>
  );
}
