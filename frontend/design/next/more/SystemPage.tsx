"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemExtractions, useSystemProfiles, useSystemsExtended, useV2Jobs } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { useOpenItem, useV2Href } from "@/lib/v2/hooks";
import { V2Link } from "@/design/v2/parts";
import { Configuration } from "@/design/v2/screens/system/Configuration";
import { CustomObjects } from "@/design/v2/screens/system/CustomObjects";
import { SourceDesign } from "@/design/v2/screens/system/SourceDesign";
import { Schedules } from "@/design/v2/screens/system/Schedules";
import { ChangeLog } from "@/design/v2/screens/step9/ChangeLog";
import { ConfigChanges } from "@/design/v2/screens/step9/Drift";
import { Button, Chip, EmptyState, SegmentedControl, Skeleton } from "../kit";
import { HEALTH_TONE, healthText } from "./Systems";
import { Connectivity } from "./system/Connectivity";
import { Mining } from "./system/Mining";
import { ProcessModel } from "./system/ProcessModel";
import { LongText, QueryView } from "./states";

type Seg = "about" | "profiles" | "extractions" | "configuration" | "changes" | "schedules" | "custom-objects" | "design" | "connectivity" | "process-model" | "mining";

/** Old `?tab=` words from the System page, so an old link opens the same view. */
const OLD_TAB: Record<string, Seg> = { overview: "about", runs: "extractions", config: "configuration", health: "schedules", custom: "custom-objects" };
const SEGS: readonly Seg[] = ["about", "profiles", "extractions", "configuration", "changes", "schedules", "custom-objects", "design", "connectivity", "process-model", "mining"];
const segFrom = (tab: string | null): Seg => (tab && (SEGS as readonly string[]).includes(tab) ? (tab as Seg) : (tab && OLD_TAB[tab]) || "about");

function Profiles({ id }: { id: string }) {
  const q = useSystemProfiles(id);
  const rows = q.data ?? [];
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("No profile yet")} emptyText={t("A profile says which object to read and how often.")} label={t("Loading profiles")}>
      <ul className="nx-pick" aria-label={t("Profiles")}>
        {rows.map((p) => (
          <li key={p.id} className="nx-row"><LongText text={p.domain} className="nx-row-main" /><span className="nx-sub">{p.schedule_cron ?? t("Manual")}</span><Chip>{p.extraction_mode === "delta" ? t("Changes only") : t("Full")}</Chip>{p.active ? null : <Chip>{t("Paused")}</Chip>}</li>
        ))}
      </ul>
    </QueryView>
  );
}

/** Every read of the system: when, how much, the run it fed, and its change log. */
function Extractions({ id }: { id: string }) {
  const q = useSystemExtractions(id);
  const rows = q.data?.versions ?? [];
  const [shown, setShown] = useState<string | null>(null);
  const chosen = rows.find((v) => v.id === shown) ?? rows[0];
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("Nothing read yet")} emptyText={t("Each read of this system is listed here.")} label={t("Loading reads")}>
      <ul className="nx-pick" aria-label={t("Reads")} data-testid="system-extractions">
        {rows.map((v) => {
          const records = Object.values(v.records).reduce((n, r) => n + r, 0);
          const when = formatDate(v.run_at, "datetime");
          return (
            <li key={v.id} className="nx-row nx-wrap">
              <LongText text={[when, v.baseline ? t("Baseline") : null, v.label].filter(Boolean).join(", ")} className="nx-row-main" />
              <span className="nx-sub">{t("{n} objects", { n: v.objects.length })}</span>
              <span className="nx-sub">{t("{records} records", { records: int(records) })}</span>
              {v.analysed_at ? <V2Link href={`/run/${v.id}`}>{t("Open the run")}</V2Link> : <span className="nx-sub">{v.analysable ? t("Not analysed") : t("Cannot be analysed")}</span>}
              <Button size={32} variant="quiet" aria-pressed={chosen?.id === v.id} aria-label={t("Change log of the download of {when}", { when })} onClick={() => setShown(v.id)}>{t("Change log")}</Button>
            </li>
          );
        })}
      </ul>
      {chosen ? <ChangeLog key={chosen.id} versionId={chosen.id} when={chosen.run_at} /> : null}
    </QueryView>
  );
}

/** What the latest run scored on this system, and its recent jobs. */
function About({ id }: { id: string }) {
  const land = useLandscape(null);
  const jobs = useV2Jobs();
  const { hrefFor } = useOpenItem();
  const L = land.data;
  const system = L?.systems.find((s) => s.id === id);
  const cells = (L?.cells ?? []).filter((c) => c.system_id === id);
  const mine = jobs.jobs.filter((j) => j.system_id === id).slice(0, 5);
  return (
    <>
      <h3>{t("Objects")}</h3>
      <QueryView loading={land.isLoading} error={land.error} onRetry={() => void land.refetch()} empty={cells.length === 0} emptyHeading={t("No object has a run on this system yet.")} emptyText={system?.state === "extracted" ? t("This system is extracted but no rule has run on it. Run an analysis.") : undefined} label={t("Loading the objects")}>
        <ul className="nx-pick" aria-label={t("Objects")} data-testid="system-objects">
          {cells.map((c) => (
            <li key={c.module} className="nx-row">
              <V2Link href={`/o/${systemSlug(system?.name ?? "")}/${moduleSlug(c.module)}`} className="nx-row-main">{L?.objects.find((o) => o.module === c.module)?.label ?? c.module}</V2Link>
              <span className="nx-sub">{f1(c.score)}</span>
              <Chip>{VERDICT_LABEL[c.verdict]}</Chip>
              <span className="nx-sub">{t("{records} records", { records: int(c.records_checked) })}</span>
            </li>
          ))}
        </ul>
      </QueryView>
      <h3>{t("Recent jobs")}</h3>
      {mine.length === 0 ? <p className="nx-sub">{t("No job has run on this system in the last 7 days.")}</p> : (
        <ul className="nx-pick" aria-label={t("Recent jobs")}>
          {mine.map((j) => (
            <li key={j.id} className="nx-row">
              <V2Link href={hrefFor({ kind: "job", id: j.id })} className="nx-row-main">{`${JOB_KIND_LABEL[j.kind]}, ${jobObject(j)}`}</V2Link>
              <Chip>{JOB_STATUS_LABEL[j.status]}</Chip>
              <span className="nx-sub">{formatDate(j.started_at * 1000, "datetime")}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * One system: what it is and what it scored, its profiles, every read, its configuration and changes, schedules, custom
 * objects and source design. Test, load, extract and connection settings open their panels, as on the old System page.
 */
export function SystemPage({ id }: { id: string }) {
  const params = useSearchParams();
  const [seg, setSeg] = useState<Seg>(() => segFrom(params.get("tab")));
  const list = useSystemsExtended();
  const href = useV2Href();
  const { hrefFor } = useOpenItem();
  if (list.isLoading) return <Skeleton lines={5} label={t("Loading system")} />;
  const s = (list.data ?? []).find((x) => x.id === id);
  if (!s) return <EmptyState heading={t("This system was not found")} action={<a className="nx-link" href={href("/more/systems")}>{t("Back to systems")}</a>}>{t("It may have been removed.")}</EmptyState>;
  return (
    <div className="nx-body" data-testid="system-page">
      <h2 className="nx-long" title={s.name}>{s.name}</h2>
      <div className="nx-row nx-wrap"><Chip>{systemTypeText(s.system_type)}</Chip><Chip>{s.environment}</Chip><Chip tone={HEALTH_TONE[s.health_status]}>{healthText(s.health_status)}</Chip></div>
      {s.health_message ? <p className="nx-sub">{s.health_message}</p> : null}
      <div className="nx-row nx-wrap" data-testid="system-actions">
        <V2Link href={hrefFor({ kind: "system", id })} className="nx-btn nx-btn-primary">{t("Test, load or extract")}</V2Link>
        <V2Link href={hrefFor({ kind: "connection", id })} className="nx-btn nx-btn-secondary nx-btn-sm">{t("Connection settings")}</V2Link>
      </div>
      <SegmentedControl label={t("System")} value={seg} onChange={setSeg} items={[
        { value: "about", label: t("About") },
        { value: "profiles", label: t("Profiles") },
        { value: "extractions", label: t("Reads") },
        { value: "configuration", label: t("Configuration") },
        { value: "changes", label: t("Configuration changes") },
        { value: "schedules", label: t("Schedules") },
        { value: "custom-objects", label: t("Custom objects") },
        { value: "design", label: t("Source design") },
        { value: "connectivity", label: t("Connectivity") },
        { value: "process-model", label: t("Process model") },
        { value: "mining", label: t("Mining") },
      ]} />
      {seg === "about" ? (
        <>
          <dl className="nx-notes">
            <dt>{t("Host")}</dt><dd><LongText text={s.host ?? s.base_url ?? "-"} /></dd>
            <dt>{t("Client")}</dt><dd>{s.client ?? "-"}</dd>
            <dt>{t("Last read")}</dt><dd>{s.last_sync_at ? formatDate(s.last_sync_at, "datetime") : t("Never")}</dd>
          </dl>
          <About id={id} />
        </>
      ) : seg === "profiles" ? <Profiles id={id} />
        : seg === "extractions" ? <Extractions id={id} />
        : seg === "configuration" ? <Configuration id={id} />
        : seg === "changes" ? <ConfigChanges systemId={id} />
        : seg === "schedules" ? <Schedules id={id} />
        : seg === "custom-objects" ? <CustomObjects id={id} />
        : seg === "connectivity" ? <Connectivity id={id} />
        : seg === "process-model" ? <ProcessModel id={id} />
        : seg === "mining" ? <Mining id={id} />
        : <SourceDesign id={id} />}
    </div>
  );
}
