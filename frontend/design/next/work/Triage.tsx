"use client";

import { useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import Link from "next/link";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  bulkTriage, createAssignRule, createTeam, deleteAssignRule, deleteTeam, getAssignable, getAssignRules, getTeams, getTriageMetrics,
  getTriageQueue, reorderAssignRules, setAssignRuleEnabled, setTeamMembers, updateTeam,
  type AssignableUser, type AssignRule, type BulkAction, type BulkBody, type QueueItem, type Team,
} from "@/lib/api/v2/triage";
import { formatDate } from "@/lib/format";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, ErrorState, PartBar, Sheet, Skeleton, Sparkline, useToast, type Column } from "../kit";
import { AreaTrend } from "../viz";
import "./triage.css";

/**
 * Triage, native (api/routes/triage.py): the ranked queue of open issues and stewardship items, overdue first, worked
 * in bulk; the SLA record of the last eight weeks; the teams that share work and the rules that route new work to them.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

const SLA_TEXT: Record<string, () => string> = { breached: () => t("Breached"), at_risk: () => t("At risk"), on_track: () => t("On track"), paused: () => t("Paused") };
const SLA_TONE: Record<string, "bad" | "warn" | "good" | "neutral"> = { breached: "bad", at_risk: "warn", on_track: "good", paused: "neutral" };
const SEV_TEXT: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };
const SEV_TONE: Record<string, "bad" | "warn" | "neutral"> = { critical: "bad", high: "warn", medium: "neutral", low: "neutral" };
const STRATEGY_TEXT: Record<Team["strategy"], () => string> = { round_robin: () => t("Take turns"), least_loaded: () => t("Fewest open items") };
const BUCKETS = [
  ["overdue", () => t("Overdue")],
  ["due_today", () => t("Due today")],
  ["later", () => t("Due later")],
] as const;
const hours = (n: number | null) => (n === null ? "—" : t("{n} h", { n: n.toFixed(1) }));
const keyOf = (x: QueueItem) => `${x.kind}:${x.id}`;
const nameOf = (id: string | null, people: AssignableUser[]) => (id ? people.find((u) => u.id === id)?.name ?? null : null);
const sevText = (s: string) => SEV_TEXT[s]?.() ?? s;

function useEditTriage() {
  const { can, shared, viewAs } = useV2Session();
  return (can("manage_triage") || can("manage_settings") || can("manage_rules")) && !shared && !viewAs;
}

/** A target select: people, then teams, as "team:<id>". */
function TargetOptions({ people, teams }: { people: AssignableUser[]; teams: Team[] }) {
  return (
    <>
      {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      {teams.map((x) => <option key={x.id} value={`team:${x.id}`}>{t("Team {name}", { name: x.name })}</option>)}
    </>
  );
}

function Fig({ label, value, note, spark }: { label: string; value: string; note: string; spark?: number[] }) {
  return (
    <div className="nx-tg-fig">
      <span className="nx-tg-dim">{label}</span>
      <span className="nx-tg-figval">
        <strong>{value}</strong>
        {spark ? <Sparkline points={spark} label={label} /> : null}
      </span>
      <small className="nx-tg-dim">{note}</small>
    </div>
  );
}

function Card({ title, meta, testId, children }: { title: string; meta?: string; testId?: string; children: ReactNode }) {
  return (
    <section className="nx-tg-card" aria-label={title} data-testid={testId}>
      <div className="nx-tg-cardhead">
        <h2 className="nx-tg-h">{title}</h2>
        {meta ? <span className="nx-tg-dim">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function WorkTriage() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const { hrefFor } = useOpenItem();
  const [who, setWho] = useUrlParam<string>("who", "me");
  const [snoozed, setSnoozed] = useState(false);
  const [bulk, setBulk] = useState<QueueItem[] | null>(null);
  const people = useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, retry });
  const teams = useQuery({ queryKey: ["triage-teams", fixture], queryFn: getTeams, staleTime: 60_000, retry });
  const metrics = useQuery({ queryKey: ["triage-metrics", fixture], queryFn: () => getTriageMetrics(8), staleTime: 60_000, retry });
  const queue = useQuery({ queryKey: ["triage-queue", fixture, who, snoozed], queryFn: () => getTriageQueue(who, snoozed), staleTime: 30_000, retry, placeholderData: keepPreviousData });
  const rules = useQuery({ queryKey: ["triage-rules", fixture], queryFn: getAssignRules, staleTime: 60_000, retry });
  const ppl = people.data ?? [];
  const tms = teams.data ?? [];

  const head = (
    <header className="nx-tg-hero">
      <p className="nx-tg-dim">{t("Work")}</p>
      <h1 className="nx-tg-title">{t("Triage")}</h1>
    </header>
  );
  if (metrics.isPending || queue.isPending) return <div className="nx-tg">{head}<Skeleton lines={8} label={t("Triage")} /></div>;
  if (metrics.isError || queue.isError) {
    const denied = status(metrics.error) === 403 || status(queue.error) === 403;
    return (
      <div className="nx-tg">
        {head}
        {denied
          ? <EmptyState icon="alert" heading={t("Your role cannot read the triage queue.")} />
          : <ErrorState sentence={t("The triage queue could not be read.")} onRetry={() => { void metrics.refetch(); void queue.refetch(); }} />}
      </div>
    );
  }

  const m = metrics.data;
  const q = queue.data;
  const items = [...q.overdue.items, ...q.due_today.items, ...q.later.items];
  const open = m.backlog_by_owner.reduce((n, o) => n + o.open, 0) + m.unassigned;
  const breached = m.backlog_by_owner.reduce((n, o) => n + o.breached, 0);
  const assign = can("assign");
  const teamName = (id: string | null) => (id ? tms.find((x) => x.id === id)?.name ?? id : null);
  const modules = [...new Set(items.map((x) => x.module).filter((x): x is string => x !== null))].sort();

  const columns: Column<QueueItem>[] = [
    {
      id: "finding",
      label: t("Finding"),
      compare: (a, b) => (a.module ?? "").localeCompare(b.module ?? ""),
      cell: (x) => (
        <span className="nx-tg-stack">
          <span>{x.check_id ? <Code code={x.check_id} text={x.module ? moduleText(x.module) : undefined} /> : x.module ? moduleText(x.module) : null}</span>
          <small className="nx-tg-dim">
            {x.kind === "queue" ? t("Stewardship item") : t("Issue")}{x.ref ? <> <Code code={x.ref} /></> : null}
            {x.check_id === "golden_writeback" && x.ref ? <>, <Link href={hrefFor({ kind: "golden", id: x.ref })}>{t("Open the golden record to approve")}</Link></> : null}
            {x.snoozed_until ? <>, {t("snoozed until {d}", { d: formatDate(x.snoozed_until, "date") })}</> : null}
            {x.sla_paused_at ? <>, {x.status === "waiting_requester" ? t("waiting for the requester") : t("waiting for SAP")}</> : null}
          </small>
        </span>
      ),
    },
    { id: "severity", label: t("Severity"), cell: (x) => (x.severity ? <Chip tone={SEV_TONE[x.severity] ?? "neutral"}>{sevText(x.severity)}</Chip> : <span className="nx-tg-dim">{t("No severity is set.")}</span>) },
    {
      id: "owner",
      label: t("Owner"),
      cell: (x) => (
        <span className="nx-tg-stack">
          <span>{nameOf(x.assigned_to, ppl) ?? x.assigned_to ?? <span className="nx-tg-dim">{t("No one is assigned")}</span>}</span>
          {x.assigned_team_id ? <small className="nx-tg-dim">{t("Team {name}", { name: teamName(x.assigned_team_id) ?? "" })}</small> : null}
        </span>
      ),
    },
    { id: "priority", label: t("Priority"), align: "end", compare: (a, b) => (a.priority ?? 9) - (b.priority ?? 9), cell: (x) => (x.priority === null ? <span className="nx-tg-dim">{t("No priority is set.")}</span> : t("P{n}", { n: int(x.priority) })) },
    { id: "sla", label: t("SLA"), cell: (x) => (x.sla_state ? <Chip tone={SLA_TONE[x.sla_state] ?? "neutral"}>{SLA_TEXT[x.sla_state]?.() ?? x.sla_state}</Chip> : <span className="nx-tg-dim">{t("No SLA applies.")}</span>) },
    { id: "due", label: t("Due"), align: "end", compare: (a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""), cell: (x) => (x.due_at ? formatDate(x.due_at, "date") : <span className="nx-tg-dim">{t("No due date is set.")}</span>) },
    {
      id: "rank",
      label: t("Rank score"),
      align: "end",
      compare: (a, b) => a.rank_score - b.rank_score,
      cell: (x) => <span title={t("Impact {i}, {u} of the SLA used", { i: int(x.impact), u: `${Math.round(x.urgency * 100)}%` })}>{int(x.rank_score)}</span>,
    },
  ];
  const pickFrom = (rows: QueueItem[]) => function bulkButton(keys: string[]) { return (
    <Button variant="primary" size={32} onClick={() => setBulk(rows.filter((x) => keys.includes(keyOf(x))))}>{t("Change the selected items")}</Button>
  ); };
  const weekly = m.weekly;

  return (
    <div className="nx-tg" data-testid="work-triage">
      {head}
      <section className="nx-tg-banner" aria-label={t("Triage")}>
        <p className="nx-tg-dim">{t("Triage")}</p>
        <h2 className="nx-tg-headline">{t("{n} items waiting, {m} past their SLA", { n: int(open), m: int(breached) })}</h2>
        {m.unassigned ? <p className="nx-tg-dim">{t("{n} have no owner yet.", { n: int(m.unassigned) })}</p> : null}
        <div className="nx-tg-figs">
          <Fig
            label={t("Resolved within SLA")}
            value={m.sla_attainment_pct === null ? "—" : `${m.sla_attainment_pct.toFixed(1)}%`}
            note={t("{n} of {m} in {w} weeks", { n: int(m.resolved_in_sla), m: int(m.resolved_total), w: int(m.weeks) })}
            spark={weekly.length > 1 ? weekly.map((w) => w.resolved_in_sla) : undefined}
          />
          <Fig label={t("Time to acknowledge")} value={hours(m.mtta_hours)} note={t("Average")} />
          <Fig label={t("Time to resolve")} value={hours(m.mttr_hours)} note={t("Average")} />
          <Fig label={t("SLA breaches")} value={int(m.breach_count)} note={t("{w} weeks", { w: int(m.weeks) })} spark={weekly.length > 1 ? weekly.map((w) => w.breached) : undefined} />
        </div>
        {assign && q.overdue.items.length ? (
          <Button variant="primary" data-testid="triage-primary" onClick={() => setBulk(q.overdue.items)}>
            {q.overdue.items.length < q.overdue.count
              ? t("Pick the first {n} of {m} past their SLA", { n: int(q.overdue.items.length), m: int(q.overdue.count) })
              : t("Pick the {n} past their SLA", { n: int(q.overdue.items.length) })}
          </Button>
        ) : null}
      </section>

      <p className="nx-tg-lede">{t("The queue of findings and stewardship items waiting for someone, split by how close each is to its deadline. Pick items, then assign, snooze or pause them in bulk.")}</p>
      <ol className="nx-tg-steps" aria-label={t("Triage steps")}>
        <li><strong>{t("Pick")}</strong> <span className="nx-tg-count">{int(items.length)}</span> <span className="nx-tg-dim">{t("Tick the items to deal with. Past-SLA items come first.")}</span></li>
        <li><strong>{t("Change them")}</strong> <span className="nx-tg-count">{int(bulk?.length ?? 0)}</span> <span className="nx-tg-dim">{t("Assign, set priority, snooze or pause the picked items together.")}</span></li>
        <li><strong>{t("Watch the SLA")}</strong> <span className="nx-tg-count">{int(breached)}</span> <span className="nx-tg-dim">{t("The count shows items already past their SLA.")}</span></li>
      </ol>
      <details className="nx-tg-more">
        <summary>{t("Glossary")}</summary>
        <dl className="nx-tg-dl">
          {([
            [t("SLA"), t("The time a team promised to deal with an item. Past SLA means the time has run out.")],
            [t("Rank score"), t("Impact of the item combined with how much of its SLA is used. Higher comes first.")],
            [t("Resolved within SLA"), t("Share of items closed on time over the weeks shown.")],
            [t("Time to acknowledge"), t("Average time from an item arriving to someone taking it.")],
          ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </details>

      <div className="nx-tg-filters">
        <label className="nx-field">
          {t("Show the work of")}
          <select className="nx-input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="me">{t("Me")}</option>
            <option value="unassigned">{t("No one yet")}</option>
            <option value="all">{t("Everyone")}</option>
            {tms.map((x) => <option key={x.id} value={`team:${x.id}`}>{t("Team {name}", { name: x.name })}</option>)}
            {ppl.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="nx-tg-inline">
          <input type="checkbox" className="nx-check" checked={snoozed} onChange={(e) => setSnoozed(e.target.checked)} />
          {t("Include snoozed items")}
        </label>
      </div>
      {assign && items.length ? <p className="nx-tg-dim">{t("Apply changes every picked item at once. Assigning gives them a new owner; snoozing hides them from the queue until the date you choose.")}</p> : null}

      {items.length === 0 ? (
        <EmptyState heading={t("Nothing is waiting here. Choose someone else or include snoozed items.")} />
      ) : BUCKETS.filter(([b]) => q[b].items.length).map(([b, label]) => (
        <Card key={`${b}-${who}-${snoozed}`} title={label()} meta={t("{n} items", { n: int(q[b].count) })} testId={`triage-${b}`}>
          <DataTable
            rows={q[b].items}
            columns={columns}
            rowKey={keyOf}
            rowLabel={(x) => `${x.module ? moduleText(x.module) : ""} ${x.check_id ?? ""} ${x.ref ?? x.id}`.trim()}
            caption={label()}
            total={q[b].count}
            selectable={assign}
            bulkActions={assign ? pickFrom(q[b].items) : undefined}
          />
        </Card>
      ))}

      <h2 className="nx-tg-h">{t("Backlog and load, charted")}</h2>
      <div className="nx-tg-charts">
        <Card title={t("Backlog burn by week")} meta={t("Resolved minus opened")} testId="triage-flow">
          <AreaTrend
            label={t("Backlog burn by week")}
            empty={t("No week has closed yet.")}
            points={weekly.map((w) => ({ label: t("Week of {d}", { d: formatDate(w.week, "date") }), value: w.resolved - w.opened }))}
          />
          {weekly.length ? (
            <ul className="nx-tg-bars">
              {weekly.map((w) => (
                <li key={w.week}><span>{t("Week of {d}", { d: formatDate(w.week, "date") })}</span><small className="nx-tg-dim">{t("{r} resolved, {o} opened", { r: int(w.resolved), o: int(w.opened) })}</small></li>
              ))}
            </ul>
          ) : null}
        </Card>
        <Card title={t("Open items by owner")} meta={t("{n} without an owner", { n: int(m.unassigned) })} testId="triage-owners">
          <LoadBars
            empty={t("No one owns open items.")}
            label={t("Open items by owner")}
            rows={m.backlog_by_owner.filter((o) => o.open > 0).map((o) => ({ key: o.user_id, name: nameOf(o.user_id, ppl) ?? o.email ?? o.user_id, open: o.open, breached: o.breached, atRisk: o.at_risk }))}
          />
        </Card>
        <Card title={t("Open items by team")} testId="triage-teams-load">
          <LoadBars
            empty={t("No team is set up yet.")}
            label={t("Open items by team")}
            rows={m.backlog_by_team.map((x) => ({ key: x.team_id, name: x.name, open: x.open, breached: x.breached, atRisk: x.at_risk }))}
          />
        </Card>
      </div>

      <h2 className="nx-tg-h">{t("Teams and assignment rules")}</h2>
      <p className="nx-tg-dim">{t("SLA days per severity and the escalation that follows are set in")}{" "}<Link href="/work/triage?open=triage">{t("Triage and SLA")}</Link></p>
      <Teams people={ppl} teams={teams} />
      <Rules people={ppl} teams={tms} modules={modules} rules={rules} />

      <BulkSheet chosen={bulk} people={ppl} teams={tms} onClose={() => setBulk(null)} />
    </div>
  );
}

function LoadBars({ rows, label, empty }: { rows: { key: string; name: string; open: number; breached: number; atRisk: number }[]; label: string; empty: string }) {
  if (!rows.length) return <p className="nx-tg-dim">{empty}</p>;
  return (
    <ul className="nx-tg-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span>{r.name}</span>
          <PartBar
            label={r.name}
            format={int}
            segments={[
              { label: t("Breached"), value: r.breached },
              { label: t("At risk"), value: r.atRisk },
              { label: t("On track"), value: Math.max(0, r.open - r.breached - r.atRisk) },
            ]}
          />
          <small className="nx-tg-dim">{t("{n} open, {b} breached", { n: int(r.open), b: int(r.breached) })}</small>
        </li>
      ))}
    </ul>
  );
}

const ACTIONS: [BulkAction | "assign_any", () => string][] = [
  ["assign_any", () => t("Assign")],
  ["release", () => t("Release")],
  ["priority", () => t("Set priority")],
  ["acknowledge", () => t("Acknowledge")],
  ["snooze", () => t("Snooze")],
  ["unsnooze", () => t("Wake up")],
  ["wait", () => t("Pause the SLA")],
  ["resume", () => t("Resume the SLA")],
];

function BulkSheet({ chosen, people, teams, onClose }: { chosen: QueueItem[] | null; people: AssignableUser[]; teams: Team[]; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<BulkAction | "assign_any">("assign_any");
  const [target, setTarget] = useState("");
  const [priority, setPriority] = useState(2);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [waiting, setWaiting] = useState<"waiting_sap" | "waiting_requester">("waiting_sap");
  const today = new Date().toISOString().slice(0, 10);
  const list = chosen ?? [];

  const run = useMutation({
    mutationFn: async () => {
      // The route takes one kind per call, and assign only takes unowned items; split the selection to match.
      const groups = new Map<string, BulkBody>();
      for (const x of list) {
        const act: BulkAction = action === "assign_any" ? (x.assigned_to ? "reassign" : "assign") : action;
        const k = `${x.kind}|${act}`;
        const body = groups.get(k) ?? { kind: x.kind, ids: [], action: act };
        body.ids.push(x.id);
        groups.set(k, body);
      }
      const extra: Partial<BulkBody> =
        action === "assign_any" ? (target.startsWith("team:") ? { team_id: target.slice(5) } : { user_id: target })
          : action === "priority" ? { priority }
            : action === "snooze" ? { reason: reason.trim(), until: new Date(`${until}T23:59:59`).toISOString() }
              : action === "wait" ? { waiting }
                : {};
      const done = await Promise.all([...groups.values()].map((b) => bulkTriage({ ...b, ...extra })));
      return done.reduce((n, r) => n + r.updated, 0);
    },
    onSuccess: (n) => {
      toast({ text: t("{n} of {m} items updated.", { n: int(n), m: int(list.length) }), tone: "good" });
      onClose();
      void qc.invalidateQueries({ queryKey: ["triage-queue"] });
      void qc.invalidateQueries({ queryKey: ["triage-metrics"] });
      void qc.invalidateQueries({ queryKey: ["triage-teams"] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The items could not be updated.")), tone: "bad" }),
  });

  const ready = action === "assign_any" ? !!target : action === "snooze" ? !!reason.trim() && until >= today : true;
  return (
    <Sheet
      open={chosen !== null}
      onClose={onClose}
      title={t("Change the selected items")}
      meta={t("{n} selected", { n: int(list.length) })}
      size="small"
      primary={<Button variant="primary" type="submit" form="nx-tg-bulk" loading={run.isPending} disabled={!ready}>{t("Apply")}</Button>}
      secondary={<Button onClick={onClose}>{t("Clear the selection")}</Button>}
    >
      <form id="nx-tg-bulk" className="nx-tg-form" aria-label={t("Change the selected items")} data-testid="triage-bulk" onSubmit={(e) => { e.preventDefault(); if (ready && !run.isPending) run.mutate(); }}>
        <label className="nx-field">
          {t("Action")}
          <select className="nx-input" value={action} onChange={(e) => setAction(e.target.value as BulkAction | "assign_any")}>
            {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l()}</option>)}
          </select>
        </label>
        {action === "assign_any" ? (
          <label className="nx-field">
            {t("Assign to")}
            <select className="nx-input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t("Choose")}</option>
              <TargetOptions people={people} teams={teams} />
            </select>
          </label>
        ) : null}
        {action === "priority" ? (
          <label className="nx-field">
            {t("Priority")}
            <select className="nx-input" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{t("P{n}", { n: int(p) })}</option>)}
            </select>
          </label>
        ) : null}
        {action === "snooze" ? (
          <>
            <label className="nx-field">
              {t("Why snooze")}
              <input className="nx-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="nx-field">
              {t("Until")}
              <input className="nx-input" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          </>
        ) : null}
        {action === "wait" ? (
          <label className="nx-field">
            {t("Waiting for")}
            <select className="nx-input" value={waiting} onChange={(e) => setWaiting(e.target.value as typeof waiting)}>
              <option value="waiting_sap">{t("SAP")}</option>
              <option value="waiting_requester">{t("The requester")}</option>
            </select>
          </label>
        ) : null}
        <p className="nx-tg-dim">{t("Apply changes every picked item at once. Assigning gives them a new owner; snoozing hides them from the queue until the date you choose.")}</p>
      </form>
    </Sheet>
  );
}

type TeamDraft = { id: string | null; name: string; strategy: Team["strategy"]; ids: string[]; lead: string | null };

function MemberPicker({ people, ids, set, label }: { people: AssignableUser[]; ids: string[]; set: (ids: string[]) => void; label: string }) {
  return (
    <fieldset className="nx-tg-pick" aria-label={label}>
      <legend className="nx-tg-dim">{label}</legend>
      {people.map((u) => (
        <label key={u.id} className="nx-tg-inline">
          <input type="checkbox" className="nx-check" checked={ids.includes(u.id)} onChange={() => set(ids.includes(u.id) ? ids.filter((x) => x !== u.id) : [...ids, u.id])} />
          {u.name}
        </label>
      ))}
    </fieldset>
  );
}

function Teams({ people, teams }: { people: AssignableUser[]; teams: UseQueryResult<Team[], unknown> }) {
  const edit = useEditTriage();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TeamDraft | null>(null);
  const [gone, setGone] = useState<Team | null>(null);
  const done = (text: string) => {
    toast({ text, tone: "good" });
    void qc.invalidateQueries({ queryKey: ["triage-teams"] });
    void qc.invalidateQueries({ queryKey: ["triage-metrics"] });
  };
  const fail = (text: string) => (e: unknown) => toast({ text: errorSentence(e, text), tone: "bad" });
  const save = useMutation({
    mutationFn: async (d: TeamDraft) => {
      if (!d.id) return createTeam({ name: d.name.trim(), strategy: d.strategy, member_ids: d.ids });
      const was = teams.data?.find((x) => x.id === d.id);
      const lead = d.lead && d.ids.includes(d.lead) ? d.lead : null;
      const patch = {
        ...(d.name.trim() !== was?.name ? { name: d.name.trim() } : {}),
        ...(d.strategy !== was?.strategy ? { strategy: d.strategy } : {}),
        ...(lead !== (was?.lead_user_id ?? null) ? { lead_user_id: lead } : {}),
      };
      if (Object.keys(patch).length) await updateTeam(d.id, patch);
      return setTeamMembers(d.id, d.ids);
    },
    onSuccess: (_r, d) => { setDraft(null); done(d.id ? t("Team saved.") : t("Team created.")); },
    onError: (e, d) => fail(d.id ? t("The team could not be saved.") : t("The team could not be created."))(e),
  });
  const remove = useMutation({
    mutationFn: deleteTeam,
    onSuccess: () => { setGone(null); done(t("Team deleted.")); },
    onError: fail(t("The team could not be deleted.")),
  });

  if (teams.isPending) return <Skeleton lines={3} label={t("Teams")} />;
  if (teams.isError) return status(teams.error) === 403 ? null : <ErrorState sentence={t("The teams could not be read.")} onRetry={() => void teams.refetch()} />;
  const list = teams.data;
  const columns: Column<Team>[] = [
    {
      id: "team",
      label: t("Team"),
      compare: (a, b) => a.name.localeCompare(b.name),
      cell: (x) => (
        <span className="nx-tg-stack">
          <span>{x.name}</span>
          {x.lead_user_id ? <small className="nx-tg-dim">{t("Led by {name}", { name: nameOf(x.lead_user_id, people) ?? x.lead_user_id })}</small> : null}
        </span>
      ),
    },
    { id: "strategy", label: t("Shares work by"), cell: (x) => STRATEGY_TEXT[x.strategy]() },
    { id: "members", label: t("Members"), cell: (x) => (x.member_ids.length ? x.member_ids.map((id) => nameOf(id, people) ?? id).join(", ") : <span className="nx-tg-dim">{t("The team has no members.")}</span>) },
    { id: "open", label: t("Open items"), align: "end", compare: (a, b) => a.open_items - b.open_items, cell: (x) => int(x.open_items) },
    {
      id: "change",
      label: t("Change"),
      hidden: !edit,
      cell: (x) => (
        <span className="nx-tg-acts">
          <Button size={32} aria-label={t("Edit {name}", { name: x.name })} onClick={() => setDraft({ id: x.id, name: x.name, strategy: x.strategy, ids: x.member_ids, lead: x.lead_user_id })}>{t("Edit")}</Button>
          <Button size={32} onClick={() => setGone(x)}>{t("Delete")}</Button>
        </span>
      ),
    },
  ];
  const editing = draft?.id ? list.find((x) => x.id === draft.id) : undefined;

  return (
    <Card title={t("Teams")} meta={t("{n} teams", { n: int(list.length) })} testId="triage-teams">
      <DataTable
        rows={list}
        columns={edit ? columns : columns.filter((c) => c.id !== "change")}
        rowKey={(x) => x.id}
        rowLabel={(x) => x.name}
        caption={t("Teams")}
        empty={{ heading: t("No team is set up yet. A team shares work by turns or by load.") }}
      />
      {edit ? <Button onClick={() => setDraft({ id: null, name: "", strategy: "round_robin", ids: [], lead: null })}>{t("Create a team")}</Button> : null}
      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={editing ? t("Team {name}", { name: editing.name }) : t("Create a team")}
        size="small"
        dirty={!!draft && (draft.id ? draft.name !== editing?.name || draft.strategy !== editing?.strategy || draft.lead !== editing?.lead_user_id || draft.ids.join() !== editing?.member_ids.join() : !!draft.name.trim() || draft.ids.length > 0)}
        primary={draft ? <Button variant="primary" loading={save.isPending} disabled={!draft.name.trim()} onClick={() => save.mutate(draft)} data-testid="triage-team-save">{draft.id ? t("Save") : t("Create team")}</Button> : null}
        secondary={<Button onClick={() => setDraft(null)}>{t("Cancel")}</Button>}
      >
        {draft ? (
          <div className="nx-tg-form" data-testid={draft.id ? "triage-team-edit" : "triage-team-new"}>
            <label className="nx-field">
              {t("Team name")}
              <input className="nx-input" value={draft.name} maxLength={draft.id ? 200 : 120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            {draft.id ? (
              <label className="nx-field">
                {t("Team lead")}
                <select className="nx-input" value={draft.lead ?? ""} onChange={(e) => setDraft({ ...draft, lead: e.target.value || null })}>
                  <option value="">{t("No lead")}</option>
                  {draft.ids.map((id) => <option key={id} value={id}>{nameOf(id, people) ?? id}</option>)}
                </select>
              </label>
            ) : null}
            <label className="nx-field">
              {t("Shares work by")}
              <select className="nx-input" value={draft.strategy} onChange={(e) => setDraft({ ...draft, strategy: e.target.value as Team["strategy"] })}>
                {(Object.keys(STRATEGY_TEXT) as Team["strategy"][]).map((s) => <option key={s} value={s}>{STRATEGY_TEXT[s]()}</option>)}
              </select>
            </label>
            <MemberPicker
              people={people}
              ids={draft.ids}
              set={(ids) => setDraft({ ...draft, ids })}
              label={editing ? t("Members of {name}", { name: editing.name }) : t("Members of the new team")}
            />
          </div>
        ) : null}
      </Sheet>
      <Confirm
        open={gone !== null}
        title={t("Delete {name}", { name: gone?.name ?? "" })}
        consequence={gone ? `${t("Open items")}: ${int(gone.open_items)}` : null}
        confirmLabel={t("Delete")}
        danger
        onConfirm={() => gone && remove.mutate(gone.id)}
        onCancel={() => setGone(null)}
      />
    </Card>
  );
}

function matchText(m: AssignRule["match"]): string {
  const parts: string[] = [];
  if (m.module?.length) parts.push(m.module.map(moduleText).join(", "));
  if (m.severity?.length) parts.push(t("severity {s}", { s: m.severity.map(sevText).join(", ") }));
  if (m.check_id?.length) parts.push(t("rule {s}", { s: m.check_id.join(", ") }));
  if (m.dimension?.length) parts.push(t("dimension {s}", { s: m.dimension.join(", ") }));
  if (m.company_code?.length) parts.push(t("company code {s}", { s: m.company_code.join(", ") }));
  if (m.plant?.length) parts.push(t("plant {s}", { s: m.plant.join(", ") }));
  if (m.sales_org?.length) parts.push(t("sales organisation {s}", { s: m.sales_org.join(", ") }));
  return parts.length ? parts.join("; ") : t("Every new item");
}

/** The rule ids in evaluation order with rows a and b swapped, as /triage/rules/reorder wants them. */
const swap = (l: AssignRule[], a: number, b: number): string[] => {
  const ids = l.map((r) => r.id);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  return ids;
};

const NO_RULE = { name: "", module: "", severity: "", target: "" };

function Rules({ people, teams, modules, rules }: { people: AssignableUser[]; teams: Team[]; modules: string[]; rules: UseQueryResult<AssignRule[], unknown> }) {
  const edit = useEditTriage();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<typeof NO_RULE | null>(null);
  const [gone, setGone] = useState<AssignRule | null>(null);
  const done = (text: string) => { toast({ text, tone: "good" }); void qc.invalidateQueries({ queryKey: ["triage-rules"] }); };
  const fail = (text: string) => (e: unknown) => toast({ text: errorSentence(e, text), tone: "bad" });
  const toggle = useMutation({
    mutationFn: (r: AssignRule) => setAssignRuleEnabled(r, !r.enabled),
    onSuccess: (r) => done(r.enabled ? t("Rule switched on.") : t("Rule switched off.")),
    onError: fail(t("The rule could not be changed.")),
  });
  const move = useMutation({ mutationFn: reorderAssignRules, onSuccess: () => done(t("Rule order saved.")), onError: fail(t("The rule order could not be saved.")) });
  const remove = useMutation({ mutationFn: deleteAssignRule, onSuccess: () => { setGone(null); done(t("Rule deleted.")); }, onError: fail(t("The rule could not be deleted.")) });
  const create = useMutation({
    mutationFn: (d: typeof NO_RULE) => createAssignRule({
      name: d.name.trim(),
      match: { ...(d.module ? { module: [d.module] } : {}), ...(d.severity ? { severity: [d.severity] } : {}) },
      ...(d.target.startsWith("team:") ? { assign_team_id: d.target.slice(5) } : { assign_user_id: d.target }),
      enabled: true,
    }),
    onSuccess: () => { setDraft(null); done(t("Rule created.")); },
    onError: fail(t("The rule could not be created.")),
  });

  if (rules.isPending) return <Skeleton lines={3} label={t("Rules that route new work")} />;
  if (rules.isError) return status(rules.error) === 403 ? null : <ErrorState sentence={t("The assignment rules could not be read.")} onRetry={() => void rules.refetch()} />;
  const list = [...rules.data].sort((a, b) => a.position - b.position);
  const columns: Column<AssignRule>[] = [
    {
      id: "rule",
      label: t("Rule"),
      cell: (r) => (
        <span className="nx-tg-stack">
          <span>{r.name}</span>
          <small className="nx-tg-dim">{t("Order {n}", { n: int(list.indexOf(r) + 1) })}</small>
        </span>
      ),
    },
    { id: "matches", label: t("Matches"), cell: (r) => matchText(r.match) },
    {
      id: "assigns",
      label: t("Assigns to"),
      cell: (r) => (r.assign_team_id
        ? t("Team {name}", { name: teams.find((x) => x.id === r.assign_team_id)?.name ?? r.assign_team_id })
        : nameOf(r.assign_user_id, people) ?? <span className="nx-tg-dim">{t("The rule names no one.")}</span>),
    },
    {
      id: "state",
      label: t("State"),
      cell: (r) => (edit
        ? <Button size={32} aria-pressed={r.enabled} disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.enabled ? t("On") : t("Off")}</Button>
        : <Chip tone={r.enabled ? "good" : "neutral"}>{r.enabled ? t("On") : t("Off")}</Chip>),
    },
    {
      id: "change",
      label: t("Change"),
      cell: (r) => {
        const i = list.indexOf(r);
        return (
          <span className="nx-tg-acts">
            <Button size={32} aria-label={t("Move {name} up", { name: r.name })} disabled={i === 0 || move.isPending} onClick={() => move.mutate(swap(list, i, i - 1))}>{t("Up")}</Button>
            <Button size={32} aria-label={t("Move {name} down", { name: r.name })} disabled={i === list.length - 1 || move.isPending} onClick={() => move.mutate(swap(list, i, i + 1))}>{t("Down")}</Button>
            <Button size={32} onClick={() => setGone(r)}>{t("Delete")}</Button>
          </span>
        );
      },
    },
  ];

  return (
    <Card
      title={t("Rules that route new work")}
      meta={t("{n} on, {m} off, first match wins", { n: int(list.filter((r) => r.enabled).length), m: int(list.filter((r) => !r.enabled).length) })}
      testId="triage-rules"
    >
      <DataTable
        rows={list}
        columns={edit ? columns : columns.filter((c) => c.id !== "change")}
        rowKey={(r) => r.id}
        rowLabel={(r) => r.name}
        caption={t("Rules that route new work")}
        empty={{ heading: t("No assignment rule is set up. New work waits with no owner.") }}
      />
      {edit ? <Button onClick={() => setDraft(NO_RULE)}>{t("Create an assignment rule")}</Button> : null}
      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={t("Create an assignment rule")}
        size="small"
        dirty={!!draft && (!!draft.name.trim() || !!draft.target)}
        primary={draft ? <Button variant="primary" loading={create.isPending} disabled={!draft.name.trim() || !draft.target} onClick={() => create.mutate(draft)}>{t("Create rule")}</Button> : null}
        secondary={<Button onClick={() => setDraft(null)}>{t("Cancel")}</Button>}
      >
        {draft ? (
          <div className="nx-tg-form" data-testid="triage-rule-new">
            <label className="nx-field">
              {t("Rule name")}
              <input className="nx-input" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="nx-field">
              {t("Object")}
              <select className="nx-input" value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>
                <option value="">{t("Any object")}</option>
                {modules.map((x) => <option key={x} value={x}>{moduleText(x)}</option>)}
              </select>
            </label>
            <label className="nx-field">
              {t("Severity")}
              <select className="nx-input" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
                <option value="">{t("Any severity")}</option>
                {Object.keys(SEV_TEXT).map((s) => <option key={s} value={s}>{sevText(s)}</option>)}
              </select>
            </label>
            <label className="nx-field">
              {t("Assign to")}
              <select className="nx-input" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })}>
                <option value="">{t("Choose")}</option>
                <TargetOptions people={people} teams={teams} />
              </select>
            </label>
          </div>
        ) : null}
      </Sheet>
      <Confirm
        open={gone !== null}
        title={t("Delete {name}", { name: gone?.name ?? "" })}
        consequence={gone ? matchText(gone.match) : null}
        confirmLabel={t("Delete")}
        danger
        onConfirm={() => gone && remove.mutate(gone.id)}
        onCancel={() => setGone(null)}
      />
    </Card>
  );
}
