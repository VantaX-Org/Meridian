"use client";

import { formatDate } from "@/lib/format";
import type { DriftAlert } from "@/lib/api/v2/step9";
import { useOpenItem } from "@/lib/v2/hooks";
import { t, tn } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { describeTable } from "@/lib/v2/sap-fields";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { driftWords } from "@/lib/v2/step9";
import { useAutomation, useDriftAlerts } from "@/lib/v2/step9-queries";
import { NxLink } from "../../kit/Link";
import { Chip, Code, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Panel } from "../cfg-parts";

const sourceWord = (s: string): string => (s === "config_sync" ? t("Configuration sync") : s === "config_load" ? t("Configuration load") : s);

function areaWords(a: DriftAlert["areas"][number]): string {
  const parts = [a.added ? t("{n} added", { n: a.added }) : "", a.removed ? t("{n} removed", { n: a.removed }) : "", a.changed ? t("{n} changed", { n: a.changed }) : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : t("no row changed");
}

/** What a drift alert did about the change: the re-score, in words, with the run it re-scores. */
function Rescore({ a }: { a: DriftAlert }) {
  if (a.rescore_queued && a.version_id) {
    return <Chip tone="good">{tn("Re-score queued: {link}", { link: <NxLink href={`/run/${encodeURIComponent(a.version_id)}`}>{t("open the run")}</NxLink> })}</Chip>;
  }
  if (!a.objects.length) return <span>{t("Not re-scored: no rule of a scored object reads these tables.")}</span>;
  return <span>{t("Not re-scored: the run has no stored dataset, or an analysis of it was already running.")}</span>;
}

function AlertItem({ a, objectHref }: { a: DriftAlert; objectHref: (module: string) => string | null }) {
  const { hrefFor } = useOpenItem();
  return (
    <li className="nx-cell-stack" data-testid="drift-alert">
      <span className="nx-row nx-wrap">
        <strong>{formatDate(a.created_at, "datetime")}</strong>
        <span>{sourceWord(a.source)}</span>
        <span className="nx-sub">{driftWords(a)}</span>
      </span>
      <span className="nx-row nx-wrap" aria-label={t("What changed")}>
        {a.areas.map((x) => (
          <Chip key={x.area}><Code code={x.area} text={describeTable(x.area) ?? undefined} /> {areaWords(x)}</Chip>
        ))}
      </span>
      <span>
        <span className="nx-sub">{t("Rules touched:")}</span>{" "}
        {a.rules.length === 0
          ? t("none")
          : a.rules.map((r, i) => (
              <span key={r.check_id}>
                {i > 0 ? ", " : ""}
                <NxLink href={hrefFor({ kind: "rule", id: r.check_id })} className="nx-link"><Code code={r.check_id} text={r.name ?? undefined} /></NxLink>
              </span>
            ))}
      </span>
      <span>
        <span className="nx-sub">{t("Objects:")}</span>{" "}
        {a.objects.length === 0
          ? t("none")
          : a.objects.map((m, i) => {
              const href = objectHref(m);
              return (
                <span key={m}>
                  {i > 0 ? ", " : ""}
                  {href ? <NxLink href={href} className="nx-link">{moduleText(m)}</NxLink> : moduleText(m)}
                </span>
              );
            })}
      </span>
      <span>
        <span className="nx-sub">{t("Owners notified:")}</span> {a.notified}
      </span>
      <Rescore a={a} />
    </li>
  );
}

/** The System page "Configuration changes" view: what changed between syncs, the rules touched, who was told, the re-score. */
export function ConfigChanges({ systemId }: { systemId: string }) {
  const q = useDriftAlerts(100);
  const auto = useAutomation();
  const land = useLandscape(null).data;
  const system = land?.systems.find((s) => s.id === systemId);
  const objectHref = (m: string) => (system ? `/o/${systemSlug(system.name)}/${moduleSlug(m)}` : null);
  const mine = (q.data?.alerts ?? []).filter((a) => a.system_id === systemId);
  return (
    <Panel title={t("Configuration changes")} meta={t("Between configuration loads and syncs, newest first")} testId="config-changes">
      {auto.data && !auto.data.drift_alerts.enabled ? <p className="nx-note">{t("Drift alerts are turned off for this tenant, so new changes are not compared. An administrator turns them on under Webhooks, Automation.")}</p> : null}
      {q.isPending ? (
        <Skeleton lines={4} label={t("Configuration changes")} />
      ) : q.isError ? (
        <ErrorState sentence={t("The configuration changes could not be read.")} onRetry={() => void q.refetch()} />
      ) : mine.length === 0 ? (
        <EmptyState heading={t("No configuration change has been seen on this system. When a configuration load or sync changes a table that a rule reads, it shows here with the rules it touches and the owners told.")} />
      ) : (
        <ul className="nx-body" aria-label={t("Configuration changes")}>
          {mine.map((a) => <AlertItem key={a.id} a={a} objectHref={objectHref} />)}
        </ul>
      )}
    </Panel>
  );
}
