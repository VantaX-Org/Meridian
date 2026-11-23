"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createAssignRule, getTriageSettings, putTriageSettings, setTeamMembers, updateTeam, type AssignRule, type AssignableUser, type Team } from "@/lib/api/v2/triage";
import { putEscalationChain, type EscalationStep } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { useEscalationChain } from "@/lib/v2/roles-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, ErrorState, Field, Input, Select, Sheet, Skeleton, Stepper, Toggle, useToast } from "@/ui/kit";
import { Row, errText } from "./shared";

/** Runs a write, toasts it, then refreshes every triage read and the escalation chain. */
export function useCfgAct() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, done: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      toast(done, "good");
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "v2" && (String(q.queryKey[1]).startsWith("triage") || q.queryKey[1] === "roles") });
      return true;
    } catch (e) { toast(errText(e), "bad"); return false; } finally { setBusy(false); }
  };
  return { run, busy };
}

const personOptions = (people: AssignableUser[], none: string) => [{ value: "", label: none }, ...people.map((p) => ({ value: p.id, label: p.name }))];

/** Names, sharing, lead and members of one team (PATCH /triage/teams/{id}, PUT /triage/teams/{id}/members). */
export function TeamSheet({ team, people, onClose }: { team: Team | null; people: AssignableUser[]; onClose: () => void }) {
  return (
    <Sheet open={team != null} onClose={onClose} label={t("Edit team")} closeLabel={t("Close")}>
      {team && <TeamForm key={team.id} team={team} people={people} onClose={onClose} />}
    </Sheet>
  );
}

function TeamForm({ team, people, onClose }: { team: Team; people: AssignableUser[]; onClose: () => void }) {
  const { run, busy } = useCfgAct();
  const [name, setName] = useState(team.name);
  const [strategy, setStrategy] = useState(team.strategy);
  const [lead, setLead] = useState(team.lead_user_id ?? "");
  const [members, setMembers] = useState(new Set(team.member_ids));
  const save = async () => {
    const ok = await run(async () => {
      await updateTeam(team.id, { name: name.trim(), strategy, lead_user_id: lead || null });
      await setTeamMembers(team.id, [...members]);
    }, t("Team saved."));
    if (ok) onClose();
  };
  return (
    <div style={{ display: "grid", gap: "var(--mx-s3)" }}>
      <Field label={t("Team name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Sharing")}>
        <Select value={strategy} onChange={(e) => setStrategy(e.target.value as Team["strategy"])} options={[{ value: "round_robin", label: t("In turn") }, { value: "least_loaded", label: t("Least loaded") }]} />
      </Field>
      <Field label={t("Lead")}><Select value={lead} onChange={(e) => setLead(e.target.value)} options={personOptions(people, t("No lead"))} /></Field>
      <fieldset style={{ border: 0, padding: 0, display: "grid", gap: "var(--mx-s2)" }}>
        <legend>{t("Members")}</legend>
        {people.map((p) => (
          <Toggle key={p.id} label={p.name} checked={members.has(p.id)}
            onChange={(v) => setMembers((m) => { const n = new Set(m); if (v) n.add(p.id); else n.delete(p.id); return n; })} />
        ))}
      </fieldset>
      <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>{t("Save team")}</Button>
    </div>
  );
}

const STEPS = () => [{ id: "match", label: t("What it matches") }, { id: "who", label: t("Who gets it") }, { id: "review", label: t("Review") }];
const SEVERITIES = ["critical", "high", "medium", "low"];
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** Three steps to add an assignment rule (POST /triage/rules). The new rule goes last, so it is checked after the others. */
export function RuleSheet({ open, people, teams, onClose }: { open: boolean; people: AssignableUser[]; teams: Team[]; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} label={t("Add assignment rule")} closeLabel={t("Close")}>
      {open && <RuleForm people={people} teams={teams} onClose={onClose} />}
    </Sheet>
  );
}

function RuleForm({ people, teams, onClose }: { people: AssignableUser[]; teams: Team[]; onClose: () => void }) {
  const { run, busy } = useCfgAct();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [modules, setModules] = useState("");
  const [checks, setChecks] = useState("");
  const [sev, setSev] = useState("");
  const [kind, setKind] = useState<"user" | "team">("user");
  const [target, setTarget] = useState("");
  const match: AssignRule["match"] = { ...(list(modules).length ? { module: list(modules) } : {}), ...(list(checks).length ? { check_id: list(checks) } : {}), ...(sev ? { severity: [sev] } : {}) };
  const targetName = kind === "user" ? people.find((p) => p.id === target)?.name : teams.find((x) => x.id === target)?.name;
  const create = async () => {
    const ok = await run(() => createAssignRule({ name: name.trim(), match, enabled: true, ...(kind === "user" ? { assign_user_id: target } : { assign_team_id: target }) }), t("Rule added."));
    if (ok) onClose();
  };
  return (
    <div style={{ display: "grid", gap: "var(--mx-s3)" }}>
      <Stepper steps={STEPS()} current={step} label={t("Steps to add a rule")} />
      {step === 0 && (
        <>
          <Field label={t("Rule name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Objects")} hint={t("Separate several with commas. Empty matches all.")}><Input value={modules} onChange={(e) => setModules(e.target.value)} /></Field>
          <Field label={t("Check ids")} hint={t("Separate several with commas. Empty matches all.")}><Input value={checks} onChange={(e) => setChecks(e.target.value)} /></Field>
          <Field label={t("Severity")}>
            <Select value={sev} onChange={(e) => setSev(e.target.value)} options={[{ value: "", label: t("Any severity") }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]} />
          </Field>
        </>
      )}
      {step === 1 && (
        <>
          <Field label={t("Assign to")}>
            <Select value={kind} onChange={(e) => { setKind(e.target.value as "user" | "team"); setTarget(""); }} options={[{ value: "user", label: t("A person") }, { value: "team", label: t("A team") }]} />
          </Field>
          <Field label={kind === "user" ? t("Person") : t("Team")}>
            <Select value={target} onChange={(e) => setTarget(e.target.value)}
              options={[{ value: "", label: t("Choose one") }, ...(kind === "user" ? people.map((p) => ({ value: p.id, label: p.name })) : teams.map((x) => ({ value: x.id, label: x.name })))]} />
          </Field>
        </>
      )}
      {step === 2 && (
        <p>{t("Rule {name} will give items that match {match} to {who}. It is checked after the rules you have now.", { name, match: Object.entries(match).map(([k, v]) => `${k}: ${v?.join(", ")}`).join("; ") || t("every item"), who: targetName ?? "" })}</p>
      )}
      <Row>
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>{t("Back")}</Button>}
        {step < 2
          ? <Button variant="primary" disabled={step === 0 ? !name.trim() : !target} onClick={() => setStep(step + 1)}>{t("Next")}</Button>
          : <Button variant="primary" disabled={busy} onClick={() => void create()}>{t("Add rule")}</Button>}
      </Row>
    </div>
  );
}

/** A confirm that names what will go. */
export function RemoveConfirm({ what, body, onConfirm, onCancel }: { what: string | null; body: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Confirm open={what != null} danger title={t("Remove {what}?", { what: what ?? "" })} confirmLabel={t("Remove")} cancelLabel={t("Cancel")} onConfirm={onConfirm} onCancel={onCancel}>{body}</Confirm>
  );
}

/** The working calendar SLA clocks count in (GET /triage/settings) and the fallback owner (PUT /triage/settings). */
export function CalendarCard({ people }: { people: AssignableUser[] }) {
  const fx = useFixture();
  const { run, busy } = useCfgAct();
  const q = useQuery({ queryKey: ["v2", "triage-settings", fx], queryFn: getTriageSettings, retry: false });
  const [pick, setPick] = useState<string | null>(null);
  const s = q.data;
  const cur = pick ?? s?.fallback_user_id ?? "";
  return (
    <Card title={t("Working calendar")} sub={t("Business-hours clocks only count these days and hours.")}
      action={<Button variant="primary" disabled={busy || !s || cur === (s.fallback_user_id ?? "")} onClick={() => s && void run(() => putTriageSettings({ ...s, fallback_user_id: cur || null }), t("Calendar saved.")).then((ok) => ok && setPick(null))}>{t("Save")}</Button>}>
      {q.isError ? <ErrorState heading={t("The calendar did not load.")} retryLabel={t("Retry")} onRetry={() => void q.refetch()} />
        : !s ? <Skeleton lines={3} label={t("Loading working calendar")} />
        : (
          <div style={{ display: "grid", gap: "var(--mx-s3)" }}>
            <p>{t("{tz}, days {days}, {from} to {to}.", { tz: s.timezone, days: s.work_days.join(", "), from: s.work_start.slice(0, 5), to: s.work_end.slice(0, 5) })}</p>
            <p>{s.holidays.length ? t("Holidays: {list}", { list: s.holidays.join(", ") }) : t("No holidays are set.")}</p>
            <Field label={t("Fallback owner")} hint={t("Gets items no rule matches.")}><Select value={cur} onChange={(e) => setPick(e.target.value)} options={personOptions(people, t("Nobody"))} /></Field>
          </div>
        )}
    </Card>
  );
}

const TARGETS = () => [{ value: "team_lead", label: t("The team lead") }, { value: "fallback", label: t("The fallback owner") }, { value: "user", label: t("A person") }];
const MAX_LEVELS = 5;

/** Who is told when an item stays open past its due time (GET and PUT /triage/escalation-chain). */
export function EscalationCard({ people }: { people: AssignableUser[] }) {
  const q = useEscalationChain();
  return (
    <Card title={t("Escalation")} sub={t("Each level tells someone when an item is still open that many minutes after it was due.")}>
      {q.isError ? <ErrorState heading={t("The escalation chain did not load.")} retryLabel={t("Retry")} onRetry={() => void q.refetch()} />
        : !q.data ? <Skeleton lines={3} label={t("Loading escalation chain")} />
        : <ChainForm key={JSON.stringify(q.data.steps)} saved={q.data.steps} people={people} />}
    </Card>
  );
}

function ChainForm({ saved, people }: { saved: EscalationStep[]; people: AssignableUser[] }) {
  const { run, busy } = useCfgAct();
  const [steps, setSteps] = useState<EscalationStep[]>(saved);
  const [ask, setAsk] = useState(false);
  const set = (i: number, p: Partial<EscalationStep>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = () => run(() => putEscalationChain(steps.map((s, i) => ({ level: i + 1, after_minutes: s.after_minutes, target: s.target, user_id: s.target === "user" ? s.user_id : null }))), t("Escalation saved."));
  return (
    <div style={{ display: "grid", gap: "var(--mx-s3)" }}>
      {steps.length === 0 && <p>{t("No escalation is set. Late items tell nobody.")}</p>}
      {steps.map((s, i) => (
        <Row key={i}>
          <Field label={t("Level {n} after (minutes)", { n: i + 1 })}>
            <Input inputMode="numeric" value={String(s.after_minutes)} onChange={(e) => set(i, { after_minutes: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </Field>
          <Field label={t("Level {n} tells", { n: i + 1 })}><Select value={s.target} onChange={(e) => set(i, { target: e.target.value as EscalationStep["target"] })} options={TARGETS()} /></Field>
          {s.target === "user" && (
            <Field label={t("Level {n} person", { n: i + 1 })}><Select value={s.user_id ?? ""} onChange={(e) => set(i, { user_id: e.target.value || null })} options={personOptions(people, t("Choose one"))} /></Field>
          )}
        </Row>
      ))}
      <Row>
        <Button variant="secondary" disabled={steps.length >= MAX_LEVELS} onClick={() => setSteps((s) => [...s, { level: s.length + 1, after_minutes: (s.at(-1)?.after_minutes ?? 0) + 60, target: "team_lead", user_id: null }])}>{t("Add level")}</Button>
        <Button variant="ghost" disabled={steps.length === 0} onClick={() => setSteps((s) => s.slice(0, -1))}>{t("Remove last level")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => (steps.length === 0 && saved.length > 0 ? setAsk(true) : void save())}>{t("Save escalation")}</Button>
      </Row>
      <RemoveConfirm what={ask ? t("the whole escalation chain") : null} body={t("Late items will tell nobody until you add a level again.")} onConfirm={() => { setAsk(false); void save(); }} onCancel={() => setAsk(false)} />
    </div>
  );
}
