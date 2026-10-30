"use client";

import "../../step9.css";
import { formatDate } from "@/lib/format";
import type { DriftAlert } from "@/lib/api/v2/step9";
import { useOpenItem } from "@/lib/v2/hooks";
import { t, tn } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { driftWords } from "@/lib/v2/step9";
import { useAutomation, useDriftAlerts } from "@/lib/v2/step9-queries";
import { VerdictMark } from "../../marks";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../../parts";

const sourceWord = (s: string): string => (s === "config_sync" ? t("Configuration sync") : s === "config_load" ? t("Configuration load") : s);

function areaWords(a: DriftAlert["areas"][number]): string {
  const parts = [a.added ? t("{n} added", { n: a.added }) : "", a.removed ? t("{n} removed", { n: a.removed }) : "", a.changed ? t("{n} changed", { n: a.changed }) : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : t("no row changed");
}

/** What a drift alert did about the change: the re-score, in words, with the run it re-scores. */
function Rescore({ a }: { a: DriftAlert }) {
  if (a.rescore_queued && a.version_id) {
    return (
      <span className="m2-v">
        <VerdictMark verdict="go" />
        {tn("Re-score queued: {link}", { link: <V2Link href={`/run/${encodeURIComponent(a.version_id)}`}>{t("open the run")}</V2Link> })}
      </span>
    );
  }
  if (!a.objects.length) return <span>{t("Not re-scored: no rule of a scored object reads these tables.")}</span>;
  return <span>{t("Not re-scored: the run has no stored dataset, or an analysis of it was already running.")}</span>;
}

function AlertItem({ a, objectHref }: { a: DriftAlert; objectHref: (module: string) => string | null }) {
  const { hrefFor } = useOpenItem();
  return (
    <li data-testid="drift-alert">
      <span className="m2-s9-h">
        <b>{formatDate(a.created_at, "datetime")}</b>
        <span>{sourceWord(a.source)}</span>
        <span className="m2-meta">{driftWords(a)}</span>
      </span>
      <span className="m2-s9-chips" aria-label={t("What changed")}>
        {a.areas.map((x) => (
          <span key={x.area} className="m2-s9-chip">
            <Mono>{x.area}</Mono> {areaWords(x)}
          </span>
        ))}
      </span>
      <span>
        <span className="m2-meta">{t("Rules touched:")}</span>{" "}
        {a.rules.length === 0
          ? t("none")
          : a.rules.map((r, i) => (
              <span key={r.check_id}>
                {i > 0 ? ", " : ""}
                <V2Link href={hrefFor({ kind: "rule", id: r.check_id })} className="m2-mono">
                  {r.check_id}
                </V2Link>
                {r.name ? ` ${r.name}` : ""}
              </span>
            ))}
      </span>
      <span>
        <span className="m2-meta">{t("Objects:")}</span>{" "}
        {a.objects.length === 0
          ? t("none")
          : a.objects.map((m, i) => {
              const href = objectHref(m);
              return (
                <span key={m}>
                  {i > 0 ? ", " : ""}
                  {href ? <V2Link href={href}>{moduleText(m)}</V2Link> : moduleText(m)}
                </span>
              );
            })}
      </span>
      <span>
        <span className="m2-meta">{t("Owners notified:")}</span> {a.notified}
      </span>
      <Rescore a={a} />
    </li>
  );
}

/** The System canvas "Configuration changes" view: what changed between syncs, the rules touched, who was told, the re-score. */
export function ConfigChanges({ systemId }: { systemId: string }) {
  const q = useDriftAlerts(100);
  const auto = useAutomation();
  const land = useLandscape(null).data;
  const system = land?.systems.find((s) => s.id === systemId);
  const objectHref = (m: string) => (system ? `/o/${systemSlug(system.name)}/${moduleSlug(m)}` : null);
  const mine = (q.data?.alerts ?? []).filter((a) => a.system_id === systemId);
  return (
    <section className="m2-sec" style={{ marginTop: 0 }} aria-label={t("Configuration changes")} data-testid="config-changes">
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Configuration changes")}</h2>
        <span className="m2-sub">{t("Between configuration loads and syncs, newest first")}</span>
      </div>
      {auto.data && !auto.data.drift_alerts.enabled ? <p className="m2-prov">{t("Drift alerts are turned off for this tenant, so new changes are not compared. An administrator turns them on under Webhooks, Automation.")}</p> : null}
      {q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The configuration changes could not be read.")}</ErrorFrame>
      ) : mine.length === 0 ? (
        <EmptyFrame>{t("No configuration change has been seen on this system. When a configuration load or sync changes a table that a rule reads, it shows here with the rules it touches and the owners told.")}</EmptyFrame>
      ) : (
        <ul className="m2-s9-list" aria-label={t("Configuration changes")}>
          {mine.map((a) => (
            <AlertItem key={a.id} a={a} objectHref={objectHref} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The inbox panel's configuration changes: the newest alerts, each opening its system's change view. */
export function DriftInbox() {
  const q = useDriftAlerts(5);
  if (q.isPending || q.isError || !q.data.alerts.length) return null;
  return (
    <section aria-label={t("Configuration changes")} data-testid="inbox-drift">
      <h3>{t("Configuration changes")}</h3>
      <ul className="m2-s9-list">
        {q.data.alerts.map((a) => (
          <li key={a.id}>
            <span className="m2-s9-h">
              <b>{a.system_name ?? t("A system")}</b>
              <span className="m2-meta">{formatDate(a.created_at, "datetime")}</span>
            </span>
            <span>
              {t("{changes}. {rules} {rules, plural, one {rule depends} other {rules depend}} on it; {owners} {owners, plural, one {owner} other {owners}} told; {rescore}.", {
                changes: driftWords(a),
                rules: a.rules.length,
                owners: a.notified,
                rescore: a.rescore_queued ? t("re-score queued") : t("not re-scored"),
              })}
            </span>
            {a.system_id ? <V2Link href={`/s/${encodeURIComponent(a.system_id)}?tab=changes`}>{t("Open the changes")}</V2Link> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
