"use client";

import { useState } from "react";
import { useCurrentUser } from "@/context/auth-context";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { bulkTriage, createTeam, getAssignable, getTeamWorkload, getTeams, getTriageQueue, setTeamMembers, type QueueItem, type Team as TeamRow, type TeamLoad } from "@/lib/api/v2/triage";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Select, Skeleton } from "@/ui/kit";
import { useCrumbs } from "@/ui/screens/flow";
import { useCan } from "@/ui/screens/admin/common";
import { ObjChip } from "@/ui/screens/work/ObjChip";
import { personLabel, sevLabel, useDo } from "@/ui/screens/work/shared";
import { day, useQ } from "./common";

const TEAM = "__team__";

/** A lead's team: who is on it, how loaded each person is, all of the team's work, and handing it between people. */
export function Team() {
  useInterfaceLang();
  const fx = useFixture();
  const crumbs = useCrumbs();
  const can = useCan();
  const me = useCurrentUser()?.id ?? null;
  const admin = can("manage_users");
  const teams = useQ(["teams"], getTeams);
  const people = useQ(["assignable"], getAssignable);
  const folk = people.data ?? [];
  const mine = (teams.data ?? []).filter((x) => admin || (me !== null && x.lead_user_id === me));
  const [pick, setPick] = useState("");
  const team = mine.find((x) => x.id === pick) ?? mine[0];

  return (
    <>
      <PageHeader crumbs={crumbs("people", t("My team"))} title={t("My team")}
        context={admin ? t("Every team, its people and its work") : t("The people you lead and the work they hold")} />
      <nav className="mx-links" aria-label={t("People and governance")}>
        <Button variant="secondary" href={withFixture("/people", fx)}>{t("People")}</Button>
        <Button variant="secondary" href={withFixture("/triage", fx)}>{t("Triage")}</Button>
      </nav>
      {admin ? <NewTeam folk={folk} onMade={setPick} /> : null}
      {teams.isPending ? <Skeleton lines={6} label={t("Loading your teams")} />
        : teams.isError ? <ErrorState heading={t("Your teams could not be loaded")} retryLabel={t("Try again")} onRetry={() => void teams.refetch()} />
        : !team ? (
          <EmptyState heading={admin ? t("No team yet") : t("You lead no team yet")}
            body={admin ? t("Make a team above, name its lead and add the people who work under them.") : t("Ask an administrator to make a team with you as its lead. Then add your people here.")} />
        ) : (
          <>
            {mine.length > 1 ? (
              <Field label={t("Team")}>
                <Select value={team.id} onChange={(e) => setPick(e.target.value)} options={mine.map((x) => ({ value: x.id, label: x.name }))} />
              </Field>
            ) : null}
            <Members team={team} folk={folk} />
            <TeamWork team={team} folk={folk} />
          </>
        )}
    </>
  );
}

type Folk = { id: string; name: string; email: string }[];

function NewTeam({ folk, onMade }: { folk: Folk; onMade: (id: string) => void }) {
  const run = useDo();
  const [name, setName] = useState("");
  const [lead, setLead] = useState("");
  const [strategy, setStrategy] = useState<TeamRow["strategy"]>("least_loaded");
  const make = async () => {
    const r = await run(() => createTeam({ name: name.trim(), strategy, member_ids: [], lead_user_id: lead || undefined }), (x) => t("Team {name} made.", { name: x.name }));
    if (r) { setName(""); setLead(""); onMade(r.id); }
  };
  return (
    <Card title={t("New team")} sub={t("Name the team and its lead. The lead then adds the people who work under them.")}>
      <Field label={t("Team name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Lead")}>
        <Select value={lead} onChange={(e) => setLead(e.target.value)} options={[{ value: "", label: t("Me") }, ...folk.map((p) => ({ value: p.id, label: personLabel(p, folk) }))]} />
      </Field>
      <Field label={t("How new work is shared")}>
        <Select value={strategy} onChange={(e) => setStrategy(e.target.value as TeamRow["strategy"])}
          options={[{ value: "least_loaded", label: t("To whoever holds the least") }, { value: "round_robin", label: t("In turn") }]} />
      </Field>
      <Button variant="primary" disabled={!name.trim()} onClick={() => void make()}>{t("Make the team")}</Button>
    </Card>
  );
}

function Members({ team, folk }: { team: TeamRow; folk: Folk }) {
  const run = useDo();
  const load = useQ(["team-load", team.id], () => getTeamWorkload(team.id));
  const [add, setAdd] = useState("");
  const outside = folk.filter((p) => p.id !== team.lead_user_id && !team.member_ids.includes(p.id));
  const save = (ids: string[], done: string) => run(() => setTeamMembers(team.id, ids), () => done);
  const join = async () => {
    const p = folk.find((x) => x.id === add);
    if (p && (await save([...team.member_ids, p.id], t("{name} joined {team}.", { name: p.name, team: team.name })))) setAdd("");
  };
  const who = (w: TeamLoad) => w.name ?? w.email;
  return (
    <Card title={t("People on {team}", { team: team.name })} sub={t("Open, overdue and done in the last 7 days, per person.")}>
      {load.isPending ? <Skeleton lines={4} label={t("Loading the team")} />
        : load.isError ? <ErrorState heading={t("The team could not be loaded")} retryLabel={t("Try again")} onRetry={() => void load.refetch()} />
        : !load.data.length ? <EmptyState heading={t("Nobody is on this team yet")} body={t("Add the first person below. New work for the team is then shared between them.")} />
        : (
          <DataTable label={t("People on the team")} rows={load.data} rowKey={(w: TeamLoad) => w.user_id}
            columns={[
              { key: "n", label: t("Person"), render: (w) => <span className="mx-col"><span>{who(w)}</span><span className="mx-muted">{w.email}</span></span>, sort: who },
              { key: "r", label: t("Role on the team"), render: (w) => (w.is_lead ? t("Lead") : t("Member")) },
              { key: "o", label: t("Open"), render: (w) => w.open, sort: (w) => w.open, align: "end" },
              { key: "l", label: t("Overdue"), render: (w) => w.overdue, sort: (w) => w.overdue, align: "end" },
              { key: "d", label: t("Done in 7 days"), render: (w) => w.resolved_7d, sort: (w) => w.resolved_7d, align: "end" },
              { key: "x", label: t("Remove"), render: (w) => (w.is_lead ? "" : (
                <Button variant="ghost" aria-label={t("Remove {name}", { name: who(w) })}
                  onClick={() => void save(team.member_ids.filter((id) => id !== w.user_id), t("{name} left {team}.", { name: who(w), team: team.name }))}>{t("Remove")}</Button>
              )) },
            ]} />
        )}
      <Field label={t("Add a person")}>
        <Select value={add} onChange={(e) => setAdd(e.target.value)} options={[{ value: "", label: t("Pick a person") }, ...outside.map((p) => ({ value: p.id, label: personLabel(p, folk) }))]} />
      </Field>
      <Button variant="secondary" disabled={!add} onClick={() => void join()}>{t("Add to the team")}</Button>
    </Card>
  );
}

function TeamWork({ team, folk }: { team: TeamRow; folk: Folk }) {
  const run = useDo();
  const q = useQ(["team-queue", team.id], () => getTriageQueue(`team:${team.id}`, false));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [to, setTo] = useState("");
  const [said, setSaid] = useState("");
  const crew = folk.filter((p) => p.id === team.lead_user_id || team.member_ids.includes(p.id));
  const nameOf = (id: string | null) => { const p = folk.find((x) => x.id === id); return p ? personLabel(p, folk) : t("Waiting in the team queue"); };
  const items = q.data ? [...q.data.overdue.items, ...q.data.due_today.items, ...q.data.later.items].filter((i) => !gone.has(i.id)) : [];
  const chosen = items.filter((i) => picked.has(i.id));
  const allPicked = items.length > 0 && chosen.length === items.length;
  const flip = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doneText = (n: number) => (to === TEAM ? t("{n} items shared out across {team}.", { n, team: team.name }) : t("{n} items assigned to {name}.", { n, name: nameOf(to) }));
  const apply = async () => {
    let n = 0;
    const done = new Set<string>();
    for (const kind of ["issue", "queue"] as const) {
      const ids = chosen.filter((i) => i.kind === kind).map((i) => i.id);
      if (!ids.length) continue;
      const r = await run(() => bulkTriage({ kind, ids, action: "reassign", team_id: team.id, user_id: to === TEAM ? undefined : to }), (x) => doneText(x.updated));
      if (!r) break;
      n += r.updated;
      for (const id of ids) done.add(id);
    }
    if (done.size) setGone((g) => new Set([...g, ...done]));
    // a failed kind keeps its rows picked so the lead can try again
    setPicked((p) => new Set([...p].filter((id) => !done.has(id))));
    setSaid(n ? doneText(n) : "");
  };
  const why = !chosen.length ? t("Pick at least one item.") : !to ? t("Pick who takes it.") : "";

  return (
    <>
      <Card title={t("Work of {team}", { team: team.name })} sub={t("{n} selected", { n: chosen.length })}>
        {q.isPending ? <Skeleton lines={5} label={t("Loading the team's work")} />
          : q.isError ? <ErrorState heading={t("The team's work could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />
          : !items.length ? <EmptyState heading={t("The team holds no open work")} body={t("Work reaches the team through assignment rules, or when someone hands it over in Triage.")} action={<Button href="/triage">{t("Open Triage")}</Button>} />
          : (
            <>
              <label className="mx-muted"><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.id)))} /> {t("Select all {n} shown", { n: items.length })}</label>
              <DataTable label={t("Team work")} rows={items} rowKey={(i: QueueItem) => i.id}
                columns={[
                  { key: "p", label: t("Pick"), render: (i) => <input type="checkbox" aria-label={t("Pick {id}", { id: i.id })} checked={picked.has(i.id)} onChange={() => flip(i.id)} /> },
                  { key: "o", label: t("Object"), render: (i) => (i.module ? <ObjChip code={i.module} /> : "") },
                  { key: "r", label: t("Rule"), render: (i) => (i.check_id ? <FieldChip code={i.check_id} /> : "") },
                  { key: "s", label: t("Severity"), render: (i) => (i.severity ? sevLabel(i.severity) : ""), sort: (i) => i.severity ?? "" },
                  { key: "h", label: t("Held by"), render: (i) => nameOf(i.assigned_to), sort: (i) => nameOf(i.assigned_to) },
                  { key: "d", label: t("Due"), render: (i) => day(i.due_at), sort: (i) => i.due_at ?? "" },
                ]} />
            </>
          )}
      </Card>
      <Card title={t("Hand over")} sub={t("Give the picked items to one person, or share them out across the team.")}>
        <Field label={t("Give to")}>
          <Select value={to} onChange={(e) => setTo(e.target.value)}
            options={[{ value: "", label: t("Pick who takes it") }, { value: TEAM, label: t("Share out across the team") }, ...crew.map((p) => ({ value: p.id, label: personLabel(p, folk) }))]} />
        </Field>
        <Button variant="primary" disabled={!!why} onClick={() => void apply()}>{t("Hand over {n} items", { n: chosen.length })}</Button>
        {why ? <span role="status" className="mx-muted"> {why}</span> : null}
        {said ? <p role="status" aria-live="polite">{said}</p> : null}
      </Card>
    </>
  );
}
