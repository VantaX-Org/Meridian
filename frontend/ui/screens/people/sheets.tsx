"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inviteUser, listRoles } from "@/lib/api/v2/admin";
import { getStewardMetrics, remindPerson, type Person } from "@/lib/api/v2/people";
import { applyBalance, createDelegation, getActivity, getMyDelegations, planBalance, revokeDelegation, undoAction, type BalanceBy, type BalancePlan } from "@/lib/api/v2/roles";
import { getAssignable } from "@/lib/api/v2/triage";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { objectsLine, roleWord, slaMet, stewardSeries } from "@/lib/v2/people";
import { BarList, Button, EmptyState, Field, FieldChip, Input, Select, StatTile, useSheet, useToast } from "@/ui/kit";
import { Gate, day, refreshV2, useQ } from "./common";

export function PersonSheet({ person: p }: { person: Person }) {
  const qc = useQueryClient();
  const toast = useToast();
  const metrics = useQ(["steward", p.id], () => getStewardMetrics(p.id));
  const activity = useQ(["activity", p.id], () => getActivity(p.id));
  const remind = useMutation({ mutationFn: () => remindPerson(p.id), onSuccess: () => { toast(t("Reminder sent"), "good"); void refreshV2(qc); } });
  const sla = slaMet(p);
  return (
    <div className="mx-col">
      <p className="mx-muted">{roleWord(p.role)}{p.email ? `, ${p.email}` : ""}</p>
      <dl className="mx-tiles">
        <StatTile label={t("Open work")} value={p.open_work} />
        <StatTile label={t("Approvals waiting")} value={p.approvals_waiting} />
        <StatTile label={t("Overdue")} value={p.overdue} />
        <StatTile label={t("SLA met")} value={sla === null ? t("n/a") : `${sla}%`} />
        <StatTile label={t("Breaches this month")} value={p.breaches_this_month} />
      </dl>
      {p.overdue > 0 && !p.is_me ? <Button variant="primary" disabled={remind.isPending} onClick={() => remind.mutate()}>{t("Remind {n}", { n: p.overdue })}</Button> : null}
      <h3 className="mx-card-t">{t("Objects")}</h3>
      {p.objects_owned.length === 0 ? <p className="mx-muted">{t("None")}</p> : (
        <ul className="mx-list" aria-label={t("Objects")}>
          {p.objects_owned.map((o) => <li key={`${o.module}-${o.as}`}><FieldChip code={o.module} description={o.label} /> <span className="mx-muted">{o.as === "owner" ? t("Owner") : t("Steward")}</span></li>)}
        </ul>
      )}
      <p className="mx-muted">{objectsLine(p)}</p>
      <h3 className="mx-card-t">{t("Steward work by period")}</h3>
      <Gate q={metrics} label={t("Loading steward work")}>
        {(m) => m === null || m.periods.length === 0 ? <EmptyState heading={t("No steward work recorded")} body={t("Periods appear once this person resolves items.")} /> : (
          <BarList label={t("Items processed")} items={stewardSeries(m.periods).map((s) => ({ id: s.period, label: s.period, value: s.processed, display: s.rate === null ? String(s.processed) : `${s.processed}, ${s.rate}%` }))} />
        )}
      </Gate>
      <h3 className="mx-card-t">{t("Recent activity")}</h3>
      <Gate q={activity} label={t("Loading activity")}>
        {(a) => a.entries.length === 0 ? <EmptyState heading={t("No activity yet")} body={t("Activity appears here after this person does something.")} /> : (
          <ul className="mx-list" aria-label={t("Recent activity")}>
            {a.entries.slice(0, 12).map((e) => <li key={e.id}>{e.action} <span className="mx-muted">{relTime(e.created_at)}</span></li>)}
          </ul>
        )}
      </Gate>
    </div>
  );
}

export function InviteSheet() {
  const qc = useQueryClient();
  const toast = useToast();
  const sheet = useSheet();
  const roles = useQ(["roles"], () => listRoles());
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const send = useMutation({
    mutationFn: () => inviteUser({ email: email.trim(), name: name.trim() || undefined, grants: [{ role_key: role || roles.data?.[0]?.key || "viewer" }] }),
    onSuccess: () => { toast(t("Invitation sent to {email}", { email }), "good"); void refreshV2(qc); sheet.close(); },
  });
  const list = roles.data ?? [];
  return (
    <form className="mx-col" onSubmit={(e) => { e.preventDefault(); if (email.trim()) send.mutate(); }}>
      <Field label={t("Email")}><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label={t("Name")} hint={t("Optional")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Role")}>
        <Select value={role || list[0]?.key || ""} onChange={(e) => setRole(e.target.value)} options={list.map((r) => ({ value: r.key, label: `${r.name}${r.description ? `, ${r.description}` : ""}` }))} />
      </Field>
      {send.isError ? <p role="alert" className="mx-muted">{t("The invitation could not be sent")}</p> : null}
      <Button variant="primary" disabled={send.isPending || !email.trim()} onClick={() => { if (email.trim()) send.mutate(); }}>{t("Send invitation")}</Button>
    </form>
  );
}

export function BalanceSheet() {
  const qc = useQueryClient();
  const toast = useToast();
  const [by, setBy] = useState<BalanceBy>("owner");
  const [plan, setPlan] = useState<BalancePlan | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const make = useMutation({ mutationFn: () => planBalance(by), onSuccess: setPlan });
  const apply = useMutation({
    mutationFn: () => applyBalance(by, plan?.moves ?? []),
    onSuccess: (r) => { setUndo(r.action_id); setPlan(null); toast(t("{n} items moved", { n: r.moved }), "good"); void refreshV2(qc); },
  });
  const back = useMutation({ mutationFn: () => undoAction(undo ?? ""), onSuccess: () => { setUndo(null); toast(t("Moves undone"), "good"); void refreshV2(qc); } });
  const name = (id: string | null) => plan?.people.find((x) => x.id === id)?.name ?? t("Unassigned");
  return (
    <div className="mx-col">
      <p className="mx-muted">{t("Even out open work across people. Review the moves, then apply them.")}</p>
      <Field label={t("Balance by")}>
        <Select value={by} onChange={(e) => { setBy(e.target.value as BalanceBy); setPlan(null); }} options={[{ value: "owner", label: t("Owner") }, { value: "object", label: t("Object") }, { value: "slice", label: t("Slice") }]} />
      </Field>
      <Button variant="secondary" disabled={make.isPending} onClick={() => make.mutate()}>{t("Plan the moves")}</Button>
      {plan ? (plan.moves.length === 0 ? <EmptyState heading={t("Already balanced")} body={t("No move would make the load more even.")} /> : (
        <>
          <ul className="mx-list" aria-label={t("Planned moves")}>
            {plan.moves.map((m, i) => <li key={i}><FieldChip code={m.module} /> {t("{n} items from {a} to {b}", { n: m.count, a: name(m.from), b: name(m.to) })}</li>)}
          </ul>
          <Button variant="primary" disabled={apply.isPending} onClick={() => apply.mutate()}>{t("Apply {n} moves", { n: plan.moved })}</Button>
        </>
      )) : null}
      {undo ? <Button variant="ghost" disabled={back.isPending} onClick={() => back.mutate()}>{t("Undo the last move")}</Button> : null}
    </div>
  );
}

export function DelegationsSheet() {
  const qc = useQueryClient();
  const mine = useQ(["delegations"], () => getMyDelegations());
  const people = useQ(["assignable"], () => getAssignable());
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [why, setWhy] = useState("");
  const list = people.data ?? [];
  const add = useMutation({ mutationFn: () => createDelegation({ to_user_id: to || list[0]?.id || "", starts_on: from, ends_on: until, reason: why.trim() || undefined }), onSuccess: () => { setWhy(""); void refreshV2(qc); } });
  const drop = useMutation({ mutationFn: (id: string) => revokeDelegation(id), onSuccess: () => void refreshV2(qc) });
  return (
    <div className="mx-col">
      <p className="mx-muted">{t("While you are away, someone covers your approvals.")}</p>
      <Field label={t("Covered by")}>
        <Select value={to || list[0]?.id || ""} onChange={(e) => setTo(e.target.value)} options={list.map((u) => ({ value: u.id, label: `${u.name}, ${roleWord(u.role)}` }))} />
      </Field>
      <Field label={t("From")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label={t("Until")}><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
      <Field label={t("Reason")} hint={t("Optional")}><Input value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
      <Button variant="primary" disabled={add.isPending || !from || !until} onClick={() => add.mutate()}>{t("Add delegation")}</Button>
      <Gate q={mine} label={t("Loading delegations")}>
        {(d) => (
          <>
            <h3 className="mx-card-t">{t("You are away")}</h3>
            {d.away.length === 0 ? <EmptyState heading={t("No delegations")} body={t("Add a delegation to hand work to another person while away.")} /> : (
              <ul className="mx-list" aria-label={t("You are away")}>
                {d.away.map((x) => <li key={x.id}>{x.to_name}, {day(x.starts_on)} {t("to")} {day(x.ends_on)} <span className="mx-muted">{x.state}</span> {x.state !== "revoked" && x.state !== "ended" ? <Button variant="ghost" onClick={() => drop.mutate(x.id)}>{t("Revoke")}</Button> : null}</li>)}
              </ul>
            )}
            <h3 className="mx-card-t">{t("You are covering")}</h3>
            {d.covering.length === 0 ? <p className="mx-muted">{t("Nobody")}</p> : (
              <ul className="mx-list" aria-label={t("You are covering")}>
                {d.covering.map((x) => <li key={x.id}>{x.from_name}, {day(x.starts_on)} {t("to")} {day(x.ends_on)}</li>)}
              </ul>
            )}
          </>
        )}
      </Gate>
    </div>
  );
}

/** Render helpers so ui/sheets.ts stays a plain .ts file. */
export const renderPerson = (a: unknown) => <PersonSheet person={a as Person} />;
export const renderInvite = () => <InviteSheet />;
export const renderBalance = () => <BalanceSheet />;
export const renderDelegations = () => <DelegationsSheet />;
