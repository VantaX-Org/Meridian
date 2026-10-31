"use client";

import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { useOpenItem } from "@/lib/v2/hooks";
import { formatDate } from "@/lib/format";
import type { SAPSystemExtended } from "@/types/api";
import { EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../../parts";
import { StatusWord } from "../../admin/kit";
import { t } from "@/lib/v2/i18n";

type Tone = "go" | "at-risk" | "no-go" | "neutral";
const TONE: Record<SAPSystemExtended["health_status"], Tone> = { healthy: "go", degraded: "at-risk", unreachable: "no-go", auth_failed: "no-go", unknown: "neutral" };
const word = (h: SAPSystemExtended["health_status"]): string =>
  ({ healthy: t("Connected"), degraded: t("Degraded"), unreachable: t("Unreachable"), auth_failed: t("Sign-in failed"), unknown: t("Not tested") })[h];
const ROW = 44;

/** `/s`: every connected system as a hairline map (sources, Meridian, targets) and a health row each. */
export function SystemsCanvas() {
  const q = useSystemsExtended();
  const { open, hrefFor } = useOpenItem();
  if (q.isError) return <><PageTitle>{t("Systems")}</PageTitle><ErrorFrame onRetry={() => void q.refetch()}>{t("The systems could not be read. Check that the API is reachable, then retry.")}</ErrorFrame></>;
  if (q.isLoading) return <><PageTitle>{t("Systems")}</PageTitle><Skeleton width="100%" height={220} /></>;
  const all = q.data ?? [];
  if (all.length === 0) return <><PageTitle>{t("Systems")}</PageTitle><EmptyFrame>{t("No system is connected yet.")} <V2Link href="/s/new">{t("Connect a system")}</V2Link></EmptyFrame></>;
  const sources = all.filter((s) => s.role !== "target");
  const targets = all.filter((s) => s.role === "target");
  const rows = Math.max(sources.length, targets.length, 1);
  const h = rows * ROW;
  const y = (i: number, n: number) => (h - n * ROW) / 2 + i * ROW + ROW / 2;
  const bad = all.filter((s) => s.health_status === "unreachable" || s.health_status === "auth_failed").length;
  const openId = open?.kind === "system" ? open.id : null;
  return (
    <div data-testid="systems-canvas">
      <PageTitle sub={t("Connections")}>{t("Systems")}</PageTitle>
      <p className="m2-finding">
        {t("{n} {n, plural, one {system} other {systems}} connected.", { n: all.length })}{" "}
        {bad > 0 ? t("{bad} cannot be reached or signed in to.", { bad }) : t("Every connection answers.")}
      </p>
      <div className="m2-cta"><V2Link href="/s/new" className="m2-btn m2-next">{t("Connect a system")}</V2Link></div>
      <svg className="m2-topo" role="img" viewBox={`0 0 600 ${h}`} aria-label={t("Which systems feed Meridian and which receive from it")}>
        {sources.map((s, i) => <line key={s.id} className="m2-topo-ln" x1="170" y1={y(i, sources.length)} x2="300" y2={h / 2} />)}
        {targets.map((s, i) => <line key={s.id} className="m2-topo-ln" x1="300" y1={h / 2} x2="430" y2={y(i, targets.length)} />)}
        <text className="m2-topo-hub" x="300" y={h / 2} textAnchor="middle" dominantBaseline="middle">{t("Meridian")}</text>
        {sources.map((s, i) => <text key={s.id} className="m2-topo-nd" x="164" y={y(i, sources.length)} textAnchor="end" dominantBaseline="middle" data-tone={TONE[s.health_status]}>{s.name}</text>)}
        {targets.map((s, i) => <text key={s.id} className="m2-topo-nd" x="436" y={y(i, targets.length)} dominantBaseline="middle" data-tone={TONE[s.health_status]}>{s.name}</text>)}
      </svg>
      <ul className="m2-sysrows" aria-label={t("Connection health")}>
        {all.map((s) => (
          <li key={s.id} data-open={openId === s.id ? "true" : undefined}>
            <V2Link href={hrefFor({ kind: "system", id: s.id })} className="m2-sysrow" aria-current={openId === s.id ? "true" : undefined}>
              <span className="m2-sysname">{s.name}<small>{s.sap_release ?? s.system_type} {s.environment}</small></span>
              <StatusWord tone={TONE[s.health_status]}>{word(s.health_status)}</StatusWord>
              <span className="m2-meta">{s.last_sync_at ? t("Last sync {when}", { when: formatDate(s.last_sync_at, "datetime") }) : t("Never synced")}</span>
              <span className="m2-meta">{s.health_status !== "healthy" && s.health_message ? s.health_message : s.last_sync_status && s.last_sync_status !== "success" ? s.last_sync_status : ""}</span>
            </V2Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
