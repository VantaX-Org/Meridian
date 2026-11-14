"use client";

import { useMemo, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { canAdminister } from "@/lib/v2/admin-sections";
import { whole } from "@/lib/v2/format";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { useRuleList } from "@/lib/v2/sys-queries";
import { useLicence, useReportHistory, useSchedules, useUsers } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { usePeople } from "@/lib/v2/approvals-queries";
import { userStatus } from "@/lib/users";
import type { HealthStatus } from "@/types/api";
import { AreaSpark, Ring, SegBar, type SparkPoint } from "../kit";
import { ChartCard, cardState, compact } from "./ChartCard";
import { healthText } from "./Systems";

const WEEK = 7 * 86_400_000;

/** Files made per week over the last eight weeks, oldest first, empty weeks kept as zero so the line is honest. */
export function filesPerWeek(dates: string[], now: number = Date.now()): SparkPoint[] {
  const start = now - 8 * WEEK;
  const counts = new Array<number>(8).fill(0);
  for (const d of dates) {
    const at = Date.parse(d);
    if (!Number.isFinite(at) || at < start || at > now) continue;
    counts[Math.min(7, Math.floor((at - start) / WEEK))] += 1;
  }
  return counts.map((value, i) => ({ label: new Date(start + i * WEEK).toLocaleDateString(undefined, { day: "numeric", month: "short" }), value }));
}

const SEVERITY = ["critical", "high", "medium", "low", "info"] as const;
const severityText = () => ({ critical: t("Critical"), high: t("High"), medium: t("Medium"), low: t("Low"), info: t("Info") });

/** Rules switched on, split by severity. */
export function RulesCard({ href }: { href?: string }) {
  const q = useRuleList();
  const rules = useMemo(() => q.data?.rules ?? [], [q.data]);
  const on = rules.filter((r) => r.enabled);
  const sev = severityText();
  return (
    <ChartCard title={t("Rules")} href={href} testId="card-rules" state={cardState(q, rules.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No rule is loaded yet.")}
      figure={compact(on.length)} figureTitle={whole(on.length)}
      line={t("{n} of {m} rules are on", { n: compact(on.length), m: compact(rules.length) })}
      chart={<SegBar label={t("Rules that are on, by severity")} format={compact} segments={SEVERITY.map((s) => ({ label: sev[s], value: on.filter((r) => r.severity === s).length }))} />} />
  );
}

/** The average pass rate of the rules that have run, out of 100, and how many of them have run. */
export function PassRateCard() {
  const q = useRuleList();
  const rules = useMemo(() => q.data?.rules ?? [], [q.data]);
  const ran = rules.filter((r) => typeof r.last_pass_rate === "number");
  const avg = ran.length ? ran.reduce((a, r) => a + (r.last_pass_rate as number), 0) / ran.length : null;
  const label = avg === null ? t("No rule has run yet") : t("Average pass rate {p}%", { p: Math.round(avg) });
  return (
    <ChartCard title={t("Pass rate")} testId="card-pass" state={cardState(q, ran.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No rule has run yet.")}
      line={ran.length < rules.length ? t("From {n} of {m} rules; the rest have not run yet.", { n: compact(ran.length), m: compact(rules.length) }) : t("From every rule.")}
      chart={<Ring value={avg} label={label}><span className="nx-chartcard-figure">{avg === null ? "" : `${Math.round(avg)}%`}</span></Ring>} />
  );
}

/** Report files made per week. */
export function FilesCard({ href }: { href?: string }) {
  const q = useReportHistory();
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? items.length;
  const points = useMemo(() => filesPerWeek(items.map((f) => f.created_at)), [items]);
  return (
    <ChartCard title={t("Reports")} href={href} testId="card-files" state={cardState(q, items.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No report has been made yet.")}
      figure={compact(total)} figureTitle={whole(total)}
      line={total > items.length ? t("Trend from the latest {n} of {m} files", { n: compact(items.length), m: compact(total) }) : t("Files made per week, last eight weeks")}
      chart={<AreaSpark points={points} label={t("Report files made per week")} />} />
  );
}

/** How each schedule's last run went. */
export function SchedulesCard() {
  const q = useSchedules();
  const items = useMemo(() => q.data ?? [], [q.data]);
  const st = { sent: t("Sent"), running: t("Running"), partial: t("Partly sent"), failed: t("Failed"), skipped: t("Skipped") };
  const keys = ["sent", "running", "partial", "failed", "skipped"] as const;
  return (
    <ChartCard title={t("Schedules")} testId="card-schedules" state={cardState(q, items.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("Nothing is scheduled yet.")}
      figure={compact(items.length)} figureTitle={whole(items.length)}
      line={t("{count, plural, one {# schedule is on} other {# schedules are on}}", { count: items.filter((s) => s.enabled).length })}
      chart={<SegBar label={t("Last run of each schedule")} format={compact} segments={[...keys.map((k) => ({ label: st[k], value: items.filter((s) => s.last_status === k).length })), { label: t("Not run yet"), value: items.filter((s) => !s.last_status).length }]} />} />
  );
}

/** Connected systems by health. */
export function SystemsCard({ href }: { href?: string }) {
  const q = useSystemsExtended();
  const all = useMemo(() => q.data ?? [], [q.data]);
  const kinds: HealthStatus[] = ["healthy", "degraded", "unreachable", "auth_failed", "unknown"];
  const ok = all.filter((s) => s.health_status === "healthy").length;
  return (
    <ChartCard title={t("Systems")} href={href} testId="card-systems" state={cardState(q, all.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No system is connected yet.")}
      figure={compact(all.length)} figureTitle={whole(all.length)}
      line={t("{n} of {m} healthy", { n: compact(ok), m: compact(all.length) })}
      chart={<SegBar label={t("Health of the systems")} format={compact} segments={kinds.map((h) => ({ label: healthText(h), value: all.filter((s) => s.health_status === h).length }))} />} />
  );
}

/** Open work held by the five largest holders, the rest summed. */
export function PeopleCard({ href }: { href?: string }) {
  const q = usePeople();
  const people = useMemo(() => q.data?.people ?? [], [q.data]);
  const holders = [...people].filter((p) => p.open_work > 0).sort((a, b) => b.open_work - a.open_work);
  const top = holders.slice(0, 5).map((p) => ({ label: p.name, value: p.open_work }));
  const rest = holders.slice(5).reduce((a, p) => a + p.open_work, 0);
  const open = holders.reduce((a, p) => a + p.open_work, 0);
  return (
    <ChartCard title={t("People")} href={href} testId="card-people" state={cardState(q, holders.length === 0)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={people.length ? t("Nobody holds open work.") : t("No people yet.")}
      figure={compact(open)} figureTitle={whole(open)}
      line={t("{count, plural, one {# person holds open work} other {# people hold open work}}", { count: holders.length })}
      chart={<SegBar label={t("Open work by person")} format={compact} segments={rest ? [...top, { label: t("Everyone else"), value: rest }] : top} />} />
  );
}

/** People by status, for those who may manage users. */
export function UsersCard({ href, title, children }: { href?: string; title?: string; children?: ReactNode }) {
  const { can } = useV2Session();
  const allowed = can("manage_users");
  const q = useUsers({}, allowed);
  const users = useMemo(() => q.data?.users ?? [], [q.data]);
  const n = (...s: string[]) => users.filter((u) => s.includes(userStatus(u))).length;
  return (
    <ChartCard title={title ?? t("People and access")} href={href} testId="card-users" state={cardState(q, users.length === 0, allowed)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("No user yet.")}
      figure={compact(users.length)} figureTitle={whole(users.length)}
      line={t("{n} active", { n: compact(n("active")) })}
      chart={<SegBar label={t("Users by status")} format={compact} segments={[{ label: t("Active"), value: n("active") }, { label: t("Invited"), value: n("invited", "invite_expired") }, { label: t("Locked"), value: n("locked", "suspended") }]} />}>{children}</ChartCard>
  );
}

/** Seats used out of the licence's seats. */
export function SeatsCard({ href, title, children }: { href?: string; title?: string; children?: ReactNode }) {
  const q = useLicence();
  const L = q.data as { seats_used?: number; seats?: number | null } | undefined;
  const has = !!L && typeof L.seats_used === "number" && !!L.seats;
  const used = L?.seats_used ?? 0;
  const seats = L?.seats ?? 0;
  return (
    <ChartCard title={title ?? t("Tenant")} href={href} testId="card-seats" state={cardState(q, !has)} onRetry={() => void q.refetch()} updatedAt={q.dataUpdatedAt}
      emptyLine={t("The licence has no seat count.")}
      line={t("{n} of {m} seats used", { n: compact(used), m: compact(seats) })}
      chart={<Ring value={has ? used : null} max={seats || 1} label={t("{n} of {m} seats used", { n: whole(used), m: whole(seats) })}><span className="nx-chartcard-figure">{compact(used)}</span></Ring>}>{children}</ChartCard>
  );
}

/** The cards at the head of More: one per native screen, each led by its chart. */
export function MoreCards() {
  const href = useV2Href();
  const { can } = useV2Session();
  return (
    <div className="nx-chartcards" data-testid="more-cards">
      <RulesCard href={href("/more/rules")} />
      <FilesCard href={href("/more/reports")} />
      <SystemsCard href={href("/more/systems")} />
      <PeopleCard href={href("/more/people")} />
      {canAdminister(can) ? <UsersCard href={href("/more/admin")} title={t("Administration")} /> : null}
    </div>
  );
}
