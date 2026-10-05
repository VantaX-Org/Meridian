"use client";

/**
 * Fix > Progress: is the backlog shrinking, who holds it, and how old is it.
 * Every chart, bar and row leads to the list it counts.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AgeingBars, BurnDown } from "@/components/aurora/data";
import { Banner, EmptyState, OwnerLadder, PageHeader, SectionCard, Select, TableSkeleton, Tally } from "@/components/ui-core";
import { useUrlState } from "@/hooks/use-url-state";
import { getPredictiveAnalytics } from "@/lib/api/analytics";
import { getIssues } from "@/lib/api/issues";
import { getMetrics } from "@/lib/api/stewardship";
import { getTriageMetrics } from "@/lib/api/triage";
import { formatModuleName } from "@/lib/format";

const WEEKS = [{ value: "8", label: "8 weeks" }, { value: "12", label: "12 weeks" }, { value: "26", label: "26 weeks" }];
const AGEING_LIMIT = 500;
const RECORDS = "/analyse?tab=records";
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export function ProgressSurface() {
  const router = useRouter();
  const [weeksRaw, setWeeks] = useUrlState("weeks", "8");
  const weeks = WEEKS.some((w) => w.value === weeksRaw) ? Number(weeksRaw) : 8;
  const metricsQ = useQuery({ queryKey: ["triage.metrics", weeks], queryFn: () => getTriageMetrics(weeks) });
  const openQ = useQuery({ queryKey: ["issues", "progress-open"], queryFn: () => getIssues({ status: "open", limit: AGEING_LIMIT }) });
  const typeQ = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics, meta: { ignoreError: true } });
  const forecastQ = useQuery({ queryKey: ["analytics.predictive"], queryFn: () => getPredictiveAnalytics(), meta: { ignoreError: true } });

  const m = metricsQ.data;
  const open = openQ.data;
  const last = m?.weekly.at(-1);
  const openNow = open?.counts.open ?? 0;
  const tracked = (open?.total ?? 0) > 0 || (m?.weekly ?? []).some((w) => w.opened || w.resolved);

  if (metricsQ.error || openQ.error) {
    return <Banner tone="danger" title="Progress could not be read">{((metricsQ.error ?? openQ.error) as Error).message}</Banner>;
  }
  if (m && open && !tracked) {
    return (
      <EmptyState action={<Link className="ui-link" href="/analyse?tab=findings">Open findings</Link>}>
        No issues tracked yet. Issues are created from findings.
      </EmptyState>
    );
  }

  const loading = !m || !open;
  const owners = [
    ...(m && m.unassigned ? [{ label: "Unassigned", open: m.unassigned, breached: 0, href: "/workbench?assignee=unassigned" }] : []),
    ...(m?.backlog_by_owner ?? []).map((o) => ({ label: o.email, open: o.open, breached: o.breached, href: `/workbench?assignee=${o.user_id}` })),
  ];
  const types = Object.entries(typeQ.data?.avg_resolution_hours_by_type ?? {}).sort((a, b) => b[1] - a[1]);
  const risky = [...(forecastQ.data?.forecasts ?? [])].sort((a, b) => a.forecast_30d - b.forecast_30d).slice(0, 5);

  return (
    <div className="ui-page">
      <PageHeader
        title="Progress"
        summary="Whether the backlog is shrinking, who holds it and how old it is."
        actions={<Select aria-label="Weeks shown" options={WEEKS} value={String(weeks)} onValueChange={setWeeks} />}
      />
      <Tally level={2} label="Progress" figures={[
        { label: "Open", value: loading ? null : openNow, loading, verdict: openNow ? "Issues a run found failing." : "None.", href: "/workbench" },
        { label: "Opened this week", value: last?.opened ?? null, loading, verdict: last?.opened ? "New since the week began." : "None.", href: last ? `${RECORDS}&week=${last.week}` : RECORDS },
        { label: "Resolved this week", value: last?.resolved ?? null, loading, tone: last?.resolved ? "success" : undefined, verdict: last?.resolved ? "Closed since the week began." : "None.", href: `${RECORDS}&status=resolved` },
        { label: "SLA attainment", value: m?.sla_attainment_pct ?? null, unit: "%", loading, verdict: m?.sla_attainment_pct != null ? "Resolved inside their SLA." : "Never.", href: "/workbench?view=breached" },
        { label: "Mean time to resolve", value: m?.mttr_hours != null ? Math.round(m.mttr_hours * 10) / 10 : null, unit: " h", loading, verdict: m?.mttr_hours != null ? "From SLA start to resolved." : "Never.", href: `${RECORDS}&status=resolved` },
      ]} />

      <SectionCard title="Burn-down" meta={`${weeks} weeks`}>
        {loading ? <TableSkeleton rows={5} label="Loading the burn-down" /> : (
          <BurnDown weeks={m.weekly} openNow={openNow} onWeekClick={(w) => router.push(`${RECORDS}&week=${w}&status=open`)} />
        )}
      </SectionCard>

      <SectionCard title="Owners" meta={m ? `${owners.length} holding work` : undefined}>
        {loading ? <TableSkeleton rows={4} label="Loading owners" />
          : owners.length ? <OwnerLadder rows={owners} ariaLabel="Open work by owner" />
          : <p className="ui-note">None.</p>}
      </SectionCard>

      <SectionCard title="Ageing" meta={open && open.total > AGEING_LIMIT ? `Of the oldest ${AGEING_LIMIT} open issues` : open ? `${open.total.toLocaleString()} open` : undefined}>
        {loading ? <TableSkeleton rows={5} label="Loading ageing" /> : (
          <AgeingBars issues={open.items} onBucketClick={(b) => router.push(`${RECORDS}&age=${encodeURIComponent(b)}&status=open`)} />
        )}
      </SectionCard>

      {m?.backlog_by_team.length ? (
        <SectionCard title="Teams">
          <OwnerLadder ariaLabel="Open work by team"
            rows={m.backlog_by_team.map((t) => ({ label: t.name, open: t.open, breached: t.breached, href: `/workbench?tab=my-queue&assignee=${encodeURIComponent(`team:${t.team_id}`)}` }))} />
        </SectionCard>
      ) : null}

      {types.length ? (
        <SectionCard title="Resolution by type" meta="Average hours to resolve">
          <dl className="ui-kv">
            {types.map(([k, h]) => (
              <div key={k} className="ui-kv__row"><dt>{label(k)}</dt><dd className="aurora-number">{h} h</dd></div>
            ))}
          </dl>
        </SectionCard>
      ) : null}

      {risky.length ? (
        <SectionCard title="Forecast" meta="Quality score in 30 days">
          <dl className="ui-kv">
            {risky.map((f) => (
              <div key={f.module_id} className="ui-kv__row">
                <dt><Link className="ui-link" href={`/analyse/object/${encodeURIComponent(f.module_id)}`}>{formatModuleName(f.module_id)}</Link></dt>
                <dd className="aurora-number">{Math.round(f.current_score)} to {Math.round(f.forecast_30d)}, confidence {Math.round(f.confidence)} %</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      ) : null}
    </div>
  );
}
