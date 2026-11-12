"use client";

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { Sev } from "../inspector/rule";
import { Consequence, FixHead, FlowSteps, MoreDetail, ObjectRunChip } from "../FixParts";
import { Dash, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcDelta, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";
import { WorkTabs } from "./WorkTabs";
import { TableExport } from "@/design/v2/TableExport";

/**
 * Triage (api/routes/triage.py): the ranked queue of open issues and stewardship items, overdue first, worked in bulk;
 * the SLA record of the last eight weeks; the teams that share work and the rules that route new work to them.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

const SLA_TEXT: Record<string, () => string> = { breached: () => t("Breached"), at_risk: () => t("At risk"), on_track: () => t("On track"), paused: () => t("Paused") };
const SEV_TEXT: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };
const STRATEGY_TEXT: Record<Team["strategy"], () => string> = { round_robin: () => t("Take turns"), least_loaded: () => t("Fewest open items") };
const BUCKETS = [
  ["overdue", () => t("Overdue")],
  ["due_today", () => t("Due today")],
  ["later", () => t("Due later")],
] as const;

const hours = (n: number | null) => (n === null ? "—" : t("{n} h", { n: n.toFixed(1) }));
const nameOf = (id: string | null, people: AssignableUser[] | undefined) => (id ? people?.find((u) => u.id === id)?.name ?? id : null);
const keyOf = (x: QueueItem) => `${x.kind}:${x.id}`;

function useEditTriage() {
  const { can, shared, viewAs } = useV2Session();
  return (can("manage_triage") || can("manage_settings") || can("manage_rules")) && !shared && !viewAs;
}

export function Triage() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const [who, setWho] = useUrlParam<string>("who", "me");
  const [snoozed, setSnoozed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const people = useQuery({ queryKey: ["assignable", fixture], queryFn: getAssignable, staleTime: 300_000, retry });
  const teams = useQuery({ queryKey: ["triage-teams", fixture], queryFn: getTeams, staleTime: 60_000, retry });
  const metrics = useQuery({ queryKey: ["triage-metrics", fixture], queryFn: () => getTriageMetrics(8), staleTime: 60_000, retry });
  const queue = useQuery({
    queryKey: ["triage-queue", fixture, who, snoozed],
    queryFn: () => getTriageQueue(who, snoozed),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry,
  });

  if (metrics.isPending || queue.isPending) return <CcPage><PageTitle sub={t("Triage")}>{t("Work")}</PageTitle><WorkTabs current="triage" /><Skeleton width="100%" height={320} /></CcPage>;
  const failed = metrics.isError ? metrics : queue.isError ? queue : null;
  if (failed) {
    return (
      <CcPage>
        <PageTitle sub={t("Triage")}>{t("Work")}</PageTitle><WorkTabs current="triage" />
        {status(failed.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the triage queue.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => { void metrics.refetch(); void queue.refetch(); }}>{t("The triage queue could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const m = metrics.data!;
  const q = queue.data!;
  const items = [...q.overdue.items, ...q.due_today.items, ...q.later.items];
  const open = m.backlog_by_owner.reduce((n, o) => n + o.open, 0) + m.unassigned;
  const breached = m.backlog_by_owner.reduce((n, o) => n + o.breached, 0);
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = items.filter((x) => picked.has(keyOf(x)));

  return (
    <CcPage>
      <PageTitle sub={t("Triage")}>{t("Work")}</PageTitle><WorkTabs current="triage" />
      <CcBanner
        eyebrow={t("Triage")}
        headline={t("{n} items waiting, {m} past their SLA", { n: int(open), m: int(breached) })}
        why={m.unassigned ? t("{n} have no owner yet.", { n: int(m.unassigned) }) : undefined}
        figs={[
          {
            label: t("Resolved within SLA"),
            value: m.sla_attainment_pct === null ? "—" : `${m.sla_attainment_pct.toFixed(1)}%`,
            note: t("{n} of {m} in {w} weeks", { n: int(m.resolved_in_sla), m: int(m.resolved_total), w: int(m.weeks) }),
          },
          { label: t("Time to acknowledge"), value: hours(m.mtta_hours), note: t("Average") },
          { label: t("Time to resolve"), value: hours(m.mttr_hours), note: t("Average") },
          { label: t("SLA breaches"), value: int(m.breach_count), note: t("{w} weeks", { w: int(m.weeks) }) },
        ]}
        action={can("assign") && q.overdue.items.length ? (
          <button type="button" className="m2-btn m2-strong" data-testid="triage-primary" onClick={() => setPicked(new Set(q.overdue.items.map(keyOf)))}>
            {q.overdue.items.length < q.overdue.count
              ? t("Pick the first {n} of {m} past their SLA", { n: int(q.overdue.items.length), m: int(q.overdue.count) })
              : t("Pick the {n} past their SLA", { n: int(q.overdue.items.length) })}
          </button>
        ) : undefined}
        testId="triage-banner"
        label={t("Triage")}
      />
      <FixHead
        lede={t("The queue of findings and stewardship items waiting for someone, split by how close each is to its deadline. Pick items, then assign, snooze or pause them in bulk.")}
        means={[
          [t("SLA"), t("The time a team promised to deal with an item. Past SLA means the time has run out.")],
          [t("Rank score"), t("Impact of the item combined with how much of its SLA is used. Higher comes first.")],
          [t("Resolved within SLA"), t("Share of items closed on time over the weeks shown.")],
          [t("Time to acknowledge"), t("Average time from an item arriving to someone taking it.")],
        ]}
      />
      <FlowSteps
        label={t("Triage steps")}
        current={picked.size ? 1 : 0}
        steps={[
          { label: t("Pick"), count: int(items.length), hint: t("Tick the items to deal with. Past-SLA items come first.") },
          { label: t("Change them"), count: int(picked.size), hint: t("Assign, set priority, snooze or pause the picked items together.") },
          { label: t("Watch the SLA"), count: int(breached), hint: t("The count shows items already past their SLA.") },
        ]}
      />
      <div className="m2-rfilters" data-testid="triage-filter">
        <label>
          {t("Show the work of")}
          <select className="m2-sel" value={who} onChange={(e) => { setWho(e.target.value); setPicked(new Set()); }}>
            <option value="me">{t("Me")}</option>
            <option value="unassigned">{t("No one yet")}</option>
            <option value="all">{t("Everyone")}</option>
            {(teams.data ?? []).map((x) => <option key={x.id} value={`team:${x.id}`}>{t("Team {name}", { name: x.name })}</option>)}
            {(people.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label className="m2-chk">
          <input type="checkbox" checked={snoozed} onChange={(e) => setSnoozed(e.target.checked)} />
          {t("Include snoozed items")}
        </label>
      </div>
      {can("assign") && chosen.length ? (
        <Bulk chosen={chosen} people={people.data ?? []} teams={teams.data ?? []} onDone={() => setPicked(new Set())} />
      ) : null}
      {can("assign") && chosen.length ? <Consequence>{t("Apply changes every picked item at once. Assigning gives them a new owner; snoozing hides them from the queue until the date you choose.")}</Consequence> : null}
      {items.length === 0 ? (
        <EmptyFrame>{t("Nothing is waiting here. Choose someone else or include snoozed items.")}</EmptyFrame>
      ) : (
        BUCKETS.map(([b, label]) => q[b].items.length ? (
          <Panel key={b} title={label()} meta={t("{n} items", { n: int(q[b].count) })} testId={`triage-${b}`}>
            <ScrollFrame label={label()}>
              <TableExport><table className="m2-tbl m2-cards">
                <caption className="m2-sr">{label()}</caption>
                <thead>
                  <tr>
                    {can("assign") ? <th scope="col"><span className="m2-sr">{t("Select")}</span></th> : null}
                    <th scope="col">{t("Finding")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Owner")}</th>
                    <th scope="col">{t("Priority")}</th>
                    <th scope="col">{t("SLA")}</th>
                    <th scope="col">{t("Due")}</th>
                    <th scope="col">{t("Rank score")}</th>
                  </tr>
                </thead>
                <tbody>
                  {q[b].items.map((x) => (
                    <Row key={keyOf(x)} x={x} people={people.data} teams={teams.data} pick={can("assign") ? { on: picked.has(keyOf(x)), toggle: () => toggle(keyOf(x)) } : null} />
                  ))}
                </tbody>
              </table></TableExport>
            </ScrollFrame>
          </Panel>
        ) : null)
      )}
      <MoreDetail title={t("Backlog and load, charted")}>
        <div className="m2-cc-split">
          <Panel title={t("Backlog burn by week")} meta={t("Resolved minus opened")} testId="triage-flow">
            {m.weekly.length === 0 ? (
              <Dash why={t("No week has closed yet.")} />
            ) : (
              <CcDelta
                label={t("Backlog burn by week")}
                rows={m.weekly.map((w) => ({
                  key: w.week,
                  label: t("Week of {d}", { d: formatDate(w.week, "date") }),
                  delta: w.resolved - w.opened,
                  text: t("{r} resolved, {o} opened", { r: int(w.resolved), o: int(w.opened) }),
                }))}
              />
            )}
          </Panel>
          <Panel title={t("Open items by owner")} meta={t("{n} without an owner", { n: int(m.unassigned) })} testId="triage-owners">
            {m.backlog_by_owner.length === 0 ? (
              <Dash why={t("No one owns open items.")} />
            ) : (
              <CcHBars
                label={t("Open items by owner")}
                rows={m.backlog_by_owner.map((o) => ({
                  key: o.user_id,
                  label: nameOf(o.user_id, people.data) ?? o.email ?? o.user_id,
                  value: o.open,
                  tone: o.breached ? "crit" : undefined,
                  text: t("{n} open, {b} breached", { n: int(o.open), b: int(o.breached) }),
                }))}
              />
            )}
          </Panel>
          <Panel title={t("Open items by team")} testId="triage-teams-load">
            {m.backlog_by_team.length === 0 ? (
              <Dash why={t("No team is set up yet.")} />
            ) : (
              <CcHBars
                label={t("Open items by team")}
                rows={m.backlog_by_team.map((x) => ({
                  key: x.team_id,
                  label: x.name,
                  value: x.open,
                  tone: x.breached ? "crit" : undefined,
                  text: t("{n} open, {b} breached", { n: int(x.open), b: int(x.breached) }),
                }))}
              />
            )}
          </Panel>
        </div>
      </MoreDetail>
      <MoreDetail title={t("Teams and assignment rules")}>
        <p className="m2-hint">{t("SLA days per severity and the escalation that follows are set in")}{" "}<V2Link href="/work/triage?open=triage">{t("Triage and SLA")}</V2Link></p>
        <Teams people={people.data ?? []} />
        <Rules people={people.data ?? []} teams={teams.data ?? []} modules={[...new Set(items.map((x) => x.module).filter((x): x is string => !!x))]} />
      </MoreDetail>
    </CcPage>
  );
}

function Row({ x, people, teams, pick }: { x: QueueItem; people: AssignableUser[] | undefined; teams: Team[] | undefined; pick: { on: boolean; toggle: () => void } | null }) {
  const { hrefFor } = useOpenItem();
  const owner = nameOf(x.assigned_to, people);
  const team = x.assigned_team_id ? teams?.find((tm) => tm.id === x.assigned_team_id)?.name ?? x.assigned_team_id : null;
  const label = `${x.module ? moduleText(x.module) : ""} ${x.check_id ?? ""} ${x.ref ?? ""}`.trim();
  return (
    <tr data-testid="triage-row">
      {pick ? (
        <td data-label={t("Select")}>
          <input type="checkbox" aria-label={t("Select {item}", { item: label })} checked={pick.on} onChange={pick.toggle} />
        </td>
      ) : null}
      <th scope="row" className="m2-card-lead">
        <ObjectRunChip module={x.module} />
        {x.check_id ? <> <Mono>{x.check_id}</Mono></> : null}
        <span className="m2-meta">
          {" "}{x.kind === "queue" ? t("Stewardship item") : t("Issue")}
          {x.ref ? <>, <Mono>{x.ref}</Mono></> : null}
          {x.check_id === "golden_writeback" && x.ref ? <>, <V2Link href={hrefFor({ kind: "golden", id: x.ref })}>{t("Open the golden record to approve")}</V2Link></> : null}
          {x.snoozed_until ? <>, {t("snoozed until {d}", { d: formatDate(x.snoozed_until, "date") })}</> : null}
          {x.sla_paused_at ? <>, {x.status === "waiting_requester" ? t("waiting for the requester") : t("waiting for SAP")}</> : null}
        </span>
      </th>
      <td data-label={t("Severity")}>{x.severity ? <Sev severity={x.severity} /> : <Dash why={t("No severity is set.")} />}</td>
      <td data-label={t("Owner")}>
        {owner ?? <Dash why={t("No one is assigned")} />}
        {team ? <span className="m2-meta"> {t("Team {name}", { name: team })}</span> : null}
      </td>
      <td data-label={t("Priority")} className="m2-num">{x.priority === null ? <Dash why={t("No priority is set.")} /> : t("P{n}", { n: int(x.priority) })}</td>
      <td data-label={t("SLA")}>{x.sla_state ? SLA_TEXT[x.sla_state]?.() ?? x.sla_state : <Dash why={t("No SLA applies.")} />}</td>
      <td data-label={t("Due")} className="m2-num">{x.due_at ? formatDate(x.due_at, "date") : <Dash why={t("No due date is set.")} />}</td>
      <td data-label={t("Rank score")} className="m2-num" title={t("Impact {i}, {u} of the SLA used", { i: int(x.impact), u: `${Math.round(x.urgency * 100)}%` })}>{int(x.rank_score)}</td>
    </tr>
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

function Bulk({ chosen, people, teams, onDone }: { chosen: QueueItem[]; people: AssignableUser[]; teams: Team[]; onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [action, setAction] = useState<BulkAction | "assign_any">("assign_any");
  const [target, setTarget] = useState("");
  const [priority, setPriority] = useState(2);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [waiting, setWaiting] = useState<"waiting_sap" | "waiting_requester">("waiting_sap");
  const today = new Date().toISOString().slice(0, 10);

  const run = useMutation({
    mutationFn: async () => {
      // The route takes one kind per call, and assign only takes unowned items; split the selection to match.
      const groups = new Map<string, BulkBody>();
      for (const x of chosen) {
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
      toast.show(t("{n} of {m} items updated.", { n: int(n), m: int(chosen.length) }));
      onDone();
      void qc.invalidateQueries({ queryKey: ["triage-queue"] });
      void qc.invalidateQueries({ queryKey: ["triage-metrics"] });
      void qc.invalidateQueries({ queryKey: ["triage-teams"] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The items could not be updated.")), "error"),
  });

  const ready = action === "assign_any" ? !!target : action === "snooze" ? !!reason.trim() && until >= today : true;
  return (
    <form className="m2-rfilters" aria-label={t("Change the selected items")} data-testid="triage-bulk" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
      <strong>{t("{n} selected", { n: int(chosen.length) })}</strong>
      <label>
        {t("Action")}
        <select className="m2-sel" value={action} onChange={(e) => setAction(e.target.value as BulkAction | "assign_any")}>
          {ACTIONS.map(([a, label]) => <option key={a} value={a}>{label()}</option>)}
        </select>
      </label>
      {action === "assign_any" ? (
        <label>
          {t("Assign to")}
          <select className="m2-sel" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t("Choose")}</option>
            {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            {teams.map((x) => <option key={x.id} value={`team:${x.id}`}>{t("Team {name}", { name: x.name })}</option>)}
          </select>
        </label>
      ) : null}
      {action === "priority" ? (
        <label>
          {t("Priority")}
          <select className="m2-sel" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>{t("P{n}", { n: int(p) })}</option>)}
          </select>
        </label>
      ) : null}
      {action === "snooze" ? (
        <>
          <label>
            {t("Why snooze")}
            <input className="m2-inp" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            {t("Until")}
            <input className="m2-inp" type="date" min={today} value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </>
      ) : null}
      {action === "wait" ? (
        <label>
          {t("Waiting for")}
          <select className="m2-sel" value={waiting} onChange={(e) => setWaiting(e.target.value as "waiting_sap" | "waiting_requester")}>
            <option value="waiting_sap">{t("SAP")}</option>
            <option value="waiting_requester">{t("The requester")}</option>
          </select>
        </label>
      ) : null}
      <button type="submit" className="m2-btn m2-next" disabled={!ready || run.isPending}>{t("Apply")}</button>
      <button type="button" className="m2-btn" onClick={onDone}>{t("Clear the selection")}</button>
    </form>
  );
}

function Teams({ people }: { people: AssignableUser[] }) {
  const fixture = useFixture();
  const edit = useEditTriage();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ name: string; strategy: Team["strategy"]; member_ids: string[] }>({ name: "", strategy: "round_robin", member_ids: [] });
  const [editing, setEditing] = useState<{ id: string; ids: string[]; name: string; strategy: Team["strategy"]; lead: string | null } | null>(null);
  const teams = useQuery({ queryKey: ["triage-teams", fixture], queryFn: getTeams, staleTime: 60_000, retry });
  const done = (msg: string) => () => {
    toast.show(msg);
    void qc.invalidateQueries({ queryKey: ["triage-teams"] });
    void qc.invalidateQueries({ queryKey: ["triage-metrics"] });
  };
  const fail = (msg: string) => (e: unknown) => toast.show(errorSentence(e, msg), "error");
  const create = useMutation({
    mutationFn: () => createTeam({ ...draft, name: draft.name.trim() }),
    onSuccess: () => { setDraft({ name: "", strategy: "round_robin", member_ids: [] }); done(t("Team created."))(); },
    onError: fail(t("The team could not be created.")),
  });
  const members = useMutation({
    mutationFn: async (e: NonNullable<typeof editing>) => {
      const was = teams.data?.find((x) => x.id === e.id);
      const lead = e.lead && e.ids.includes(e.lead) ? e.lead : null;
      const patch = {
        ...(e.name.trim() !== was?.name ? { name: e.name.trim() } : {}),
        ...(e.strategy !== was?.strategy ? { strategy: e.strategy } : {}),
        ...(lead !== (was?.lead_user_id ?? null) ? { lead_user_id: lead } : {}),
      };
      if (Object.keys(patch).length) await updateTeam(e.id, patch);
      await setTeamMembers(e.id, e.ids);
    },
    onSuccess: () => { setEditing(null); done(t("Team saved."))(); },
    onError: fail(t("The team could not be saved.")),
  });
  const remove = useMutation({
    mutationFn: deleteTeam,
    onSuccess: done(t("Team deleted.")),
    onError: fail(t("The team could not be deleted.")),
  });
  const flip = (ids: string[], id: string) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const picker = (ids: string[], set: (ids: string[]) => void, label: string) => (
    <fieldset className="m2-rfilters" aria-label={label}>
      {people.map((u) => (
        <label key={u.id} className="m2-chk">
          <input type="checkbox" checked={ids.includes(u.id)} onChange={() => set(flip(ids, u.id))} />
          {u.name}
        </label>
      ))}
    </fieldset>
  );

  if (teams.isPending) return <Skeleton width="100%" height={120} />;
  if (teams.isError) return status(teams.error) === 403 ? null : <ErrorFrame onRetry={() => void teams.refetch()}>{t("The teams could not be read.")}</ErrorFrame>;
  const list = teams.data;
  return (
    <Panel title={t("Teams")} meta={t("{n} teams", { n: int(list.length) })} testId="triage-teams">
      {list.length === 0 ? (
        <EmptyFrame>{t("No team is set up yet. A team shares work by turns or by load.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Teams")}>
          <TableExport><table className="m2-tbl m2-cards">
            <caption className="m2-sr">{t("Teams")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Team")}</th>
                <th scope="col">{t("Shares work by")}</th>
                <th scope="col">{t("Members")}</th>
                <th scope="col">{t("Open items")}</th>
                {edit ? <th scope="col">{t("Change")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <th scope="row" className="m2-card-lead">
                    {editing?.id === x.id ? (
                      <>
                        <input className="m2-inp" aria-label={t("Team name")} value={editing.name} maxLength={200} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                        <select className="m2-sel" aria-label={t("Team lead")} value={editing.lead ?? ""} onChange={(e) => setEditing({ ...editing, lead: e.target.value || null })}>
                          <option value="">{t("No lead")}</option>
                          {editing.ids.map((id) => <option key={id} value={id}>{nameOf(id, people) ?? id}</option>)}
                        </select>
                      </>
                    ) : x.name}
                    {editing?.id !== x.id && x.lead_user_id ? <span className="m2-meta"> {t("Led by {name}", { name: nameOf(x.lead_user_id, people) ?? x.lead_user_id })}</span> : null}
                  </th>
                  <td data-label={t("Shares work by")}>
                    {editing?.id === x.id ? (
                      <select className="m2-sel" aria-label={t("Shares work by")} value={editing.strategy} onChange={(e) => setEditing({ ...editing, strategy: e.target.value as Team["strategy"] })}>
                        <option value="round_robin">{STRATEGY_TEXT.round_robin()}</option>
                        <option value="least_loaded">{STRATEGY_TEXT.least_loaded()}</option>
                      </select>
                    ) : STRATEGY_TEXT[x.strategy]()}
                  </td>
                  <td data-label={t("Members")}>
                    {editing?.id === x.id
                      ? picker(editing.ids, (ids) => setEditing({ ...editing, ids }), t("Members of {name}", { name: x.name }))
                      : x.member_ids.length ? x.member_ids.map((id) => nameOf(id, people) ?? id).join(", ") : <Dash why={t("The team has no members.")} />}
                  </td>
                  <td data-label={t("Open items")} className="m2-num">{int(x.open_items)}</td>
                  {edit ? (
                    <td data-label={t("Change")}>
                      {editing?.id === x.id ? (
                        <>
                          <button type="button" className="m2-btn m2-next" disabled={members.isPending || !editing.name.trim()} onClick={() => members.mutate(editing)}>{t("Save")}</button>
                          <button type="button" className="m2-btn" onClick={() => setEditing(null)}>{t("Cancel")}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="m2-btn" onClick={() => setEditing({ id: x.id, ids: x.member_ids, name: x.name, strategy: x.strategy, lead: x.lead_user_id })}>{t("Edit")}</button>
                          <button type="button" className="m2-btn" disabled={remove.isPending} onClick={() => remove.mutate(x.id)}>{t("Delete")}</button>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table></TableExport>
        </ScrollFrame>
      )}
      {edit ? (
        <form className="m2-rfilters" aria-label={t("Create a team")} data-testid="triage-team-new" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label>
            {t("Team name")}
            <input className="m2-inp" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            {t("Shares work by")}
            <select className="m2-sel" value={draft.strategy} onChange={(e) => setDraft({ ...draft, strategy: e.target.value as Team["strategy"] })}>
              <option value="round_robin">{STRATEGY_TEXT.round_robin()}</option>
              <option value="least_loaded">{STRATEGY_TEXT.least_loaded()}</option>
            </select>
          </label>
          {picker(draft.member_ids, (ids) => setDraft({ ...draft, member_ids: ids }), t("Members of the new team"))}
          <button type="submit" className="m2-btn" disabled={!draft.name.trim() || create.isPending}>{t("Create team")}</button>
        </form>
      ) : null}
    </Panel>
  );
}

function matchText(m: AssignRule["match"]): string {
  const parts: string[] = [];
  if (m.module?.length) parts.push(m.module.map(moduleText).join(", "));
  if (m.severity?.length) parts.push(t("severity {s}", { s: m.severity.map((s) => SEV_TEXT[s]?.() ?? s).join(", ") }));
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

function Rules({ people, teams, modules }: { people: AssignableUser[]; teams: Team[]; modules: string[] }) {
  const fixture = useFixture();
  const edit = useEditTriage();
  const toast = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ name: "", module: "", severity: "", target: "" });
  const rules = useQuery({ queryKey: ["triage-rules", fixture], queryFn: getAssignRules, staleTime: 60_000, retry });
  const done = (msg: string) => () => { toast.show(msg); void qc.invalidateQueries({ queryKey: ["triage-rules"] }); };
  const fail = (msg: string) => (e: unknown) => toast.show(errorSentence(e, msg), "error");
  const toggle = useMutation({
    mutationFn: (r: AssignRule) => setAssignRuleEnabled(r, !r.enabled),
    onSuccess: (r) => done(r.enabled ? t("Rule switched on.") : t("Rule switched off."))(),
    onError: fail(t("The rule could not be changed.")),
  });
  const move = useMutation({ mutationFn: reorderAssignRules, onSuccess: done(t("Rule order saved.")), onError: fail(t("The rule order could not be saved.")) });
  const remove = useMutation({ mutationFn: deleteAssignRule, onSuccess: done(t("Rule deleted.")), onError: fail(t("The rule could not be deleted.")) });
  const create = useMutation({
    mutationFn: () => createAssignRule({
      name: draft.name.trim(),
      match: { ...(draft.module ? { module: [draft.module] } : {}), ...(draft.severity ? { severity: [draft.severity] } : {}) },
      ...(draft.target.startsWith("team:") ? { assign_team_id: draft.target.slice(5) } : { assign_user_id: draft.target }),
      enabled: true,
    }),
    onSuccess: () => { setDraft({ name: "", module: "", severity: "", target: "" }); done(t("Rule created."))(); },
    onError: fail(t("The rule could not be created.")),
  });

  if (rules.isPending) return <Skeleton width="100%" height={120} />;
  if (rules.isError) return status(rules.error) === 403 ? null : <ErrorFrame onRetry={() => void rules.refetch()}>{t("The assignment rules could not be read.")}</ErrorFrame>;
  const list = rules.data;
  const known = [...new Set([...modules, ...list.flatMap((r) => r.match.module ?? [])])].sort();
  return (
    <Panel
      title={t("Rules that route new work")}
      meta={t("{n} on, {m} off, first match wins", { n: int(list.filter((r) => r.enabled).length), m: int(list.filter((r) => !r.enabled).length) })}
      testId="triage-rules"
    >
      {list.length === 0 ? (
        <EmptyFrame>{t("No assignment rule is set up. New work waits with no owner.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Rules that route new work")}>
          <TableExport><table className="m2-tbl m2-cards">
            <caption className="m2-sr">{t("Rules that route new work")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Rule")}</th>
                <th scope="col">{t("Matches")}</th>
                <th scope="col">{t("Assigns to")}</th>
                <th scope="col">{t("State")}</th>
                {edit ? <th scope="col">{t("Change")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={r.id}>
                  <th scope="row" className="m2-card-lead">
                    {r.name}
                    <span className="m2-meta"> {t("Order {n}", { n: int(i + 1) })}</span>
                  </th>
                  <td data-label={t("Matches")}>{matchText(r.match)}</td>
                  <td data-label={t("Assigns to")}>
                    {r.assign_team_id
                      ? t("Team {name}", { name: teams.find((x) => x.id === r.assign_team_id)?.name ?? r.assign_team_id })
                      : nameOf(r.assign_user_id, people) ?? <Dash why={t("The rule names no one.")} />}
                  </td>
                  <td data-label={t("State")}>
                    {edit ? (
                      <button type="button" className="m2-btn" aria-pressed={r.enabled} disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>
                        {r.enabled ? t("On") : t("Off")}
                      </button>
                    ) : r.enabled ? t("On") : t("Off")}
                  </td>
                  {edit ? (
                    <td data-label={t("Change")}>
                      <button type="button" className="m2-btn" aria-label={t("Move {name} up", { name: r.name })} disabled={i === 0 || move.isPending} onClick={() => move.mutate(swap(list, i, i - 1))}>{t("Up")}</button>
                      <button type="button" className="m2-btn" aria-label={t("Move {name} down", { name: r.name })} disabled={i === list.length - 1 || move.isPending} onClick={() => move.mutate(swap(list, i, i + 1))}>{t("Down")}</button>
                      <button type="button" className="m2-btn" disabled={remove.isPending} onClick={() => remove.mutate(r.id)}>{t("Delete")}</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table></TableExport>
        </ScrollFrame>
      )}
      {edit ? (
        <form className="m2-rfilters" aria-label={t("Create an assignment rule")} data-testid="triage-rule-new" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label>
            {t("Rule name")}
            <input className="m2-inp" value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            {t("Object")}
            <select className="m2-sel" value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>
              <option value="">{t("Any object")}</option>
              {known.map((x) => <option key={x} value={x}>{moduleText(x)}</option>)}
            </select>
          </label>
          <label>
            {t("Severity")}
            <select className="m2-sel" value={draft.severity} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
              <option value="">{t("Any severity")}</option>
              {Object.keys(SEV_TEXT).map((s) => <option key={s} value={s}>{SEV_TEXT[s]()}</option>)}
            </select>
          </label>
          <label>
            {t("Assign to")}
            <select className="m2-sel" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })}>
              <option value="">{t("Choose")}</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              {teams.map((x) => <option key={x.id} value={`team:${x.id}`}>{t("Team {name}", { name: x.name })}</option>)}
            </select>
          </label>
          <button type="submit" className="m2-btn" disabled={!draft.name.trim() || !draft.target || create.isPending}>{t("Create rule")}</button>
        </form>
      ) : null}
    </Panel>
  );
}
