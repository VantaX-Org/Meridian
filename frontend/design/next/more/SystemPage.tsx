"use client";

import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useSystemConfigLoad, useSystemExtractions, useSystemProfiles, useSystemsExtended } from "@/lib/v2/runs-queries";
import { useV2Href } from "@/lib/v2/hooks";
import { Chip, EmptyState, SegmentedControl, Skeleton } from "../kit";
import { HEALTH_TONE, healthText } from "./Systems";
import { LongText, QueryView } from "./states";

type Seg = "about" | "profiles" | "extractions" | "config";

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

function Extractions({ id }: { id: string }) {
  const q = useSystemExtractions(id);
  const rows = q.data?.versions ?? [];
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={rows.length === 0} emptyHeading={t("Nothing read yet")} emptyText={t("Each read of this system is listed here.")} label={t("Loading reads")}>
      <ul className="nx-pick" aria-label={t("Reads")}>
        {rows.map((v) => (
          <li key={v.id} className="nx-row"><LongText text={v.label ?? v.run_at} className="nx-row-main" /><span className="nx-sub">{t("{n} objects", { n: v.objects.length })}</span><Chip>{v.status}</Chip></li>
        ))}
      </ul>
    </QueryView>
  );
}

function Config({ id }: { id: string }) {
  const q = useSystemConfigLoad(id);
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={!q.data} emptyHeading={t("Settings not read yet")} emptyText={t("The system's own settings have not been loaded.")} label={t("Loading settings")}>
      {q.data ? <p>{t("{done} of {total} areas loaded", { done: q.data.areas_loaded, total: q.data.areas_total })}</p> : null}
    </QueryView>
  );
}

/** One system: what it is, its profiles, what has been read from it, and its settings load. */
export function SystemPage({ id }: { id: string }) {
  const [seg, setSeg] = useState<Seg>("about");
  const list = useSystemsExtended();
  const href = useV2Href();
  if (list.isLoading) return <Skeleton lines={5} label={t("Loading system")} />;
  const s = (list.data ?? []).find((x) => x.id === id);
  if (!s) return <EmptyState heading={t("This system was not found")} action={<a className="nx-link" href={href("/more/systems")}>{t("Back to systems")}</a>}>{t("It may have been removed.")}</EmptyState>;
  return (
    <div className="nx-body">
      <h2 className="nx-long" title={s.name}>{s.name}</h2>
      <div className="nx-row"><Chip>{systemTypeText(s.system_type)}</Chip><Chip>{s.environment}</Chip><Chip tone={HEALTH_TONE[s.health_status]}>{healthText(s.health_status)}</Chip></div>
      <SegmentedControl label={t("System")} value={seg} onChange={(v) => setSeg(v as Seg)} items={[{ value: "about", label: t("About") }, { value: "profiles", label: t("Profiles") }, { value: "extractions", label: t("Reads") }, { value: "config", label: t("Settings") }]} />
      {seg === "about" ? (
        <dl className="nx-notes">
          <dt>{t("Host")}</dt><dd><LongText text={s.host ?? s.base_url ?? "-"} /></dd>
          <dt>{t("Client")}</dt><dd>{s.client ?? "-"}</dd>
          <dt>{t("Last read")}</dt><dd>{s.last_sync_at ?? t("Never")}</dd>
        </dl>
      ) : seg === "profiles" ? <Profiles id={id} /> : seg === "extractions" ? <Extractions id={id} /> : <Config id={id} />}
    </div>
  );
}
