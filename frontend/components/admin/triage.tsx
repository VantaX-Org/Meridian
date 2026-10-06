"use client";

/**
 * Admin, Triage: who gets new issues and steward tasks (teams and ordered
 * assignment rules), how long they have (SLA policies) and the working
 * calendar the clocks run on. Teams, rules and policies need manage_rules;
 * the calendar needs manage_settings; everyone else can read.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, Drawer, Field, Input, Select, Stack, Text, Textarea } from "@/components/aurora";
import { PageHeader, StatusBadge, Tally } from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import {
  createRule, createTeam, deleteRule, deleteSlaPolicy, deleteTeam, getRules, getSlaPolicies, getTeams, getTriageSettings,
  reorderRules, saveSlaPolicy, saveTriageSettings, setTeamMembers, updateRule, updateTeam,
  type AssignmentRule, type RuleMatch, type SlaPolicy, type TeamStrategy, type TriageSettings, type TriageSeverity, type TriageTeam,
} from "@/lib/api/triage";
import { getAssignableUsers } from "@/lib/api/users";
import { formatModuleName } from "@/lib/format";

type User = { id: string; name: string; email: string };
const SEVERITIES: TriageSeverity[] = ["critical", "high", "medium", "low"];
const STRATEGIES = [{ value: "round_robin", label: "Round robin" }, { value: "least_loaded", label: "Least loaded" }];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MATCH_FIELDS = [
  ["module", "Modules"], ["check_id", "Check ids"], ["dimension", "Dimensions"],
  ["company_code", "Company codes"], ["plant", "Plants"], ["sales_org", "Sales orgs"],
] as const;
type ListField = (typeof MATCH_FIELDS)[number][0];

const HREF = "/admin?tab=triage";
const errText = (e: unknown, fallback: string) => (e as Error).message || fallback;
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const toggled = <T,>(xs: T[], x: T, on: boolean) => (on ? [...xs, x] : xs.filter((y) => y !== x));
const mins = (m: number | null) => (m == null ? "None" : m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`);

function useUsers() {
  const { can } = useRole();
  const q = useQuery({ queryKey: ["users.assignable"], queryFn: getAssignableUsers, enabled: can("assign") });
  const users: User[] = q.data ?? [];
  const name = (id: string | null) => (!id ? "None" : users.find((u) => u.id === id)?.name ?? id.slice(0, 8));
  return { users, name };
}

function Section({ id, title, action, children }: { id: string; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <Stack direction="row" gap={3} align="center">
        <Text as="h2" id={id} variant="text-lead">{title}</Text>
        <span style={{ flex: 1 }} />
        {action}
      </Stack>
      {children}
    </section>
  );
}

export function TriageAdminSurface() {
  const { can } = useRole();
  const rules = can("manage_rules");
  const settings = can("manage_settings");
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const ruleQ = useQuery({ queryKey: ["triage.rules"], queryFn: getRules });
  const sla = useQuery({ queryKey: ["triage.sla"], queryFn: getSlaPolicies });
  const idle = (ruleQ.data ?? []).filter((r) => !r.enabled).length;
  const custom = (sla.data ?? []).filter((p) => !p.is_default).length;
  return (
    <div className="ui-page">
      <PageHeader title="Triage" summary="Who gets new issues, how long they have, and the calendar the clocks run on." />
      <Tally level={4} label="Triage setup" figures={[
        { label: "Teams", value: teams.isLoading ? null : teams.data?.length ?? 0, loading: teams.isLoading, verdict: teams.data?.length ? "Rules can route to a team." : "No team to route to yet.", href: HREF },
        { label: "Assignment rules", value: ruleQ.isLoading ? null : ruleQ.data?.length ?? 0, loading: ruleQ.isLoading, tone: idle ? "warning" : undefined, verdict: idle ? `${idle} switched off.` : ruleQ.data?.length ? "Every rule is active." : "Items go to the fallback user.", href: HREF },
        { label: "SLA policies", value: sla.isLoading ? null : custom, loading: sla.isLoading, verdict: custom ? "Saved by you." : "Defaults apply.", href: HREF },
      ]} />
      {!rules && !settings ? <Banner tone="info" title="Read only">Changing triage needs the manage rules or manage settings permission.</Banner> : null}
      <TeamsSection write={rules} />
      <RulesSection write={rules} />
      <PoliciesSection write={rules} />
      <CalendarSection write={settings} />
    </div>
  );
}

/* ---------- Teams ---------- */

function TeamsSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const { users, name } = useUsers();
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const [editing, setEditing] = useState<TriageTeam | "new" | null>(null);
  const remove = useMutation({
    mutationFn: deleteTeam,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["triage.teams"] }); void qc.invalidateQueries({ queryKey: ["triage.rules"] }); toast.success("Team deleted"); },
    onError: (e) => toast.error(errText(e, "Team not deleted")),
  });
  return (
    <Section id="triage-teams" title="Teams" action={write ? <Button size="sm" onClick={() => setEditing("new")}>New team</Button> : null}>
      {teams.isLoading ? <Text tone="muted">Reading teams.</Text>
        : teams.error ? <Banner tone="danger" title="Teams could not be read">{errText(teams.error, "")}</Banner>
        : teams.data?.length ? (
          <table className="ui-mini-table">
            <thead><tr><th>Name</th><th>Strategy</th><th>Lead</th><th>Members</th><th>Open items</th>{write ? <th /> : null}</tr></thead>
            <tbody>{teams.data.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{STRATEGIES.find((s) => s.value === t.strategy)?.label}</td>
                <td>{name(t.lead_user_id)}</td>
                <td title={t.member_ids.map(name).join(", ")} className="aurora-number">{t.member_ids.length}</td>
                <td className="aurora-number">{t.open_items}</td>
                {write ? (
                  <td><Stack direction="row" gap={2}>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={remove.isPending}
                      onClick={() => window.confirm(`Delete ${t.name}? Rules that route to it are deleted too.`) && remove.mutate(t.id)}>Delete</Button>
                  </Stack></td>
                ) : null}
              </tr>
            ))}</tbody>
          </table>
        ) : <Text tone="muted">No teams yet. Rules can route to a team, which then picks a member.</Text>}
      <Drawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="Team" header={<Text variant="text-lead">{editing === "new" ? "New team" : "Edit team"}</Text>}>
        {editing ? <TeamForm team={editing === "new" ? null : editing} users={users} onDone={() => setEditing(null)} /> : null}
      </Drawer>
    </Section>
  );
}

function TeamForm({ team, users, onDone }: { team: TriageTeam | null; users: User[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [teamName, setTeamName] = useState(team?.name ?? "");
  const [strategy, setStrategy] = useState<TeamStrategy>(team?.strategy ?? "round_robin");
  const [lead, setLead] = useState(team?.lead_user_id ?? "");
  const [members, setMembers] = useState<string[]>(team?.member_ids ?? []);
  const save = useMutation({
    mutationFn: async () => {
      const body = { name: teamName.trim(), strategy, lead_user_id: lead || null };
      if (!team) return createTeam({ ...body, member_ids: members });
      await updateTeam(team.id, body);
      return setTeamMembers(team.id, members);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["triage.teams"] }); toast.success("Team saved"); onDone(); },
    onError: (e) => toast.error(errText(e, "Team not saved")),
  });
  return (
    <Stack gap={3}>
      <Field label="Name" required>{({ controlId }) => <Input id={controlId} value={teamName} onChange={(e) => setTeamName(e.target.value)} />}</Field>
      <Field label="Strategy" helper="How the team picks a member for a new item.">
        {({ controlId }) => <Select id={controlId} options={STRATEGIES} value={strategy} onValueChange={(v) => setStrategy(v === "least_loaded" ? v : "round_robin")} />}
      </Field>
      <Field label="Lead">{({ controlId }) => <Select id={controlId} options={[{ value: "", label: "No lead" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} value={lead} onValueChange={setLead} />}</Field>
      <fieldset>
        <legend><Text variant="text-small">Members</Text></legend>
        {users.length ? users.map((u) => (
          <label key={u.id} style={{ display: "block" }}>
            <input type="checkbox" checked={members.includes(u.id)} onChange={(e) => setMembers((m) => toggled(m, u.id, e.target.checked))} /> {u.name} <Text as="span" variant="text-micro" tone="muted">{u.email}</Text>
          </label>
        )) : <Text variant="text-small" tone="muted">The user list needs the assign permission.</Text>}
      </fieldset>
      <Stack direction="row" gap={2}>
        <Button disabled={save.isPending || !teamName.trim()} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save team"}</Button>
        <Button variant="ghost" onClick={onDone}>Close without saving</Button>
      </Stack>
    </Stack>
  );
}

/* ---------- Assignment rules ---------- */

function RulesSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const { users, name } = useUsers();
  const rules = useQuery({ queryKey: ["triage.rules"], queryFn: getRules });
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const [editing, setEditing] = useState<AssignmentRule | "new" | null>(null);
  const done = (msg: string) => { void qc.invalidateQueries({ queryKey: ["triage.rules"] }); toast.success(msg); };
  // PATCH is a full replace, so the toggle resends the whole rule.
  const toggle = useMutation({
    mutationFn: (r: AssignmentRule) => updateRule(r.id, { name: r.name, match: r.match, assign_user_id: r.assign_user_id, assign_team_id: r.assign_team_id, enabled: !r.enabled }),
    onSuccess: (r) => done(r.enabled ? "Rule enabled" : "Rule disabled"),
    onError: (e) => toast.error(errText(e, "Rule not changed")),
  });
  const move = useMutation({
    mutationFn: ({ i, by }: { i: number; by: -1 | 1 }) => {
      const ids = (rules.data ?? []).map((r) => r.id);
      [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
      return reorderRules(ids);
    },
    onSuccess: () => done("Order saved"),
    onError: (e) => toast.error(errText(e, "Order not saved")),
  });
  const remove = useMutation({ mutationFn: deleteRule, onSuccess: () => done("Rule deleted"), onError: (e) => toast.error(errText(e, "Rule not deleted")) });
  const target = (r: AssignmentRule) => (r.assign_team_id ? `Team: ${teams.data?.find((t) => t.id === r.assign_team_id)?.name ?? r.assign_team_id.slice(0, 8)}` : name(r.assign_user_id));
  const matchText = (m: RuleMatch) => Object.entries(m).filter(([, v]) => v?.length).map(([k, v]) => `${k.replace(/_/g, " ")}: ${(v as string[]).join(", ")}`).join("; ") || "Everything";
  const busy = toggle.isPending || move.isPending || remove.isPending;
  const rows = rules.data ?? [];
  return (
    <Section id="triage-rules" title="Assignment rules" action={write ? <Button size="sm" onClick={() => setEditing("new")}>New rule</Button> : null}>
      <Text variant="text-small" tone="secondary">The first enabled rule that matches a new item decides who gets it.</Text>
      {rules.isLoading ? <Text tone="muted">Reading rules.</Text>
        : rules.error ? <Banner tone="danger" title="Rules could not be read">{errText(rules.error, "")}</Banner>
        : rows.length ? (
          <table className="ui-mini-table">
            <thead><tr><th>#</th><th>Name</th><th>Matches</th><th>Assigns to</th><th>Enabled</th>{write ? <th /> : null}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.id}>
                <td className="aurora-number">{i + 1}</td>
                <td>{r.name}</td>
                <td><Text variant="text-small">{matchText(r.match)}</Text></td>
                <td>{target(r)}</td>
                <td><input type="checkbox" aria-label={`Enable ${r.name}`} checked={r.enabled} disabled={!write || busy} onChange={() => toggle.mutate(r)} /></td>
                {write ? (
                  <td><Stack direction="row" gap={1}>
                    <Button size="sm" variant="ghost" aria-label={`Move ${r.name} up`} disabled={busy || i === 0} onClick={() => move.mutate({ i, by: -1 })}>Up</Button>
                    <Button size="sm" variant="ghost" aria-label={`Move ${r.name} down`} disabled={busy || i === rows.length - 1} onClick={() => move.mutate({ i, by: 1 })}>Down</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(`Delete rule ${r.name}?`) && remove.mutate(r.id)}>Delete</Button>
                  </Stack></td>
                ) : null}
              </tr>
            ))}</tbody>
          </table>
        ) : <Text tone="muted">No rules yet. Unmatched items go to the fallback user in the calendar settings.</Text>}
      <Drawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="Assignment rule" header={<Text variant="text-lead">{editing === "new" ? "New rule" : "Edit rule"}</Text>}>
        {editing ? <RuleForm rule={editing === "new" ? null : editing} users={users} teams={teams.data ?? []} onDone={() => setEditing(null)} /> : null}
      </Drawer>
    </Section>
  );
}

function RuleForm({ rule, users, teams, onDone }: { rule: AssignmentRule | null; users: User[]; teams: TriageTeam[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [ruleName, setRuleName] = useState(rule?.name ?? "");
  const [to, setTo] = useState(rule?.assign_team_id ? `team:${rule.assign_team_id}` : rule?.assign_user_id ? `user:${rule.assign_user_id}` : "");
  const [matchSeverity, setMatchSeverity] = useState<TriageSeverity[]>(rule?.match.severity ?? []);
  const [fields, setFields] = useState<Record<ListField, string>>(
    () => Object.fromEntries(MATCH_FIELDS.map(([k]) => [k, (rule?.match[k] ?? []).join(", ")])) as Record<ListField, string>,
  );
  const save = useMutation({
    mutationFn: () => {
      const match: RuleMatch = matchSeverity.length ? { severity: matchSeverity } : {};
      MATCH_FIELDS.forEach(([k]) => { const v = list(fields[k]); if (v.length) match[k] = v; });
      const body = {
        name: ruleName.trim(), match, enabled: rule?.enabled ?? true,
        assign_user_id: to.startsWith("user:") ? to.slice(5) : null, assign_team_id: to.startsWith("team:") ? to.slice(5) : null,
      };
      return rule ? updateRule(rule.id, body) : createRule(body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["triage.rules"] }); toast.success("Rule saved"); onDone(); },
    onError: (e) => toast.error(errText(e, "Rule not saved")),
  });
  const targets = [
    { value: "", label: "Choose…" },
    ...users.map((u) => ({ value: `user:${u.id}`, label: u.name })),
    ...teams.map((t) => ({ value: `team:${t.id}`, label: `Team: ${t.name}` })),
  ];
  return (
    <Stack gap={3}>
      <Field label="Name" required>{({ controlId }) => <Input id={controlId} value={ruleName} onChange={(e) => setRuleName(e.target.value)} />}</Field>
      <Field label="Assign to" required>{({ controlId }) => <Select id={controlId} options={targets} value={to} onValueChange={setTo} />}</Field>
      <Stack gap={1}>
        <Text variant="text-small">Severity</Text>
        <Stack direction="row" gap={2} wrap>
          {SEVERITIES.map((s) => <Chip key={s} selected={matchSeverity.includes(s)} onClick={() => setMatchSeverity((xs) => toggled(xs, s, !xs.includes(s)))}>{s}</Chip>)}
        </Stack>
      </Stack>
      {MATCH_FIELDS.map(([k, l]) => (
        <Field key={k} label={l} helper="Comma separated. Leave blank to match any.">
          {({ controlId }) => <Input id={controlId} value={fields[k]} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))} />}
        </Field>
      ))}
      <Stack direction="row" gap={2}>
        <Button disabled={save.isPending || !ruleName.trim() || !to} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save rule"}</Button>
        <Button variant="ghost" onClick={onDone}>Close without saving</Button>
      </Stack>
    </Stack>
  );
}

/* ---------- SLA policies ---------- */

function PoliciesSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const policies = useQuery({ queryKey: ["triage.sla"], queryFn: getSlaPolicies });
  const [editing, setEditing] = useState<SlaPolicy | "new" | null>(null);
  const remove = useMutation({
    mutationFn: deleteSlaPolicy,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["triage.sla"] }); toast.success("Policy deleted"); },
    onError: (e) => toast.error(errText(e, "Policy not deleted")),
  });
  return (
    <Section id="triage-sla" title="SLA policies" action={write ? <Button size="sm" onClick={() => setEditing("new")}>New policy</Button> : null}>
      <Text variant="text-small" tone="secondary">A module policy wins over the all-modules policy for the same severity. Defaults apply until you save a policy.</Text>
      {policies.isLoading ? <Text tone="muted">Reading policies.</Text>
        : policies.error ? <Banner tone="danger" title="Policies could not be read">{errText(policies.error, "")}</Banner>
        : (
          <table className="ui-mini-table">
            <thead><tr><th>Severity</th><th>Module</th><th>Acknowledge</th><th>Resolve</th><th>At risk</th><th>Business hours</th><th />{write ? <th /> : null}</tr></thead>
            <tbody>{(policies.data ?? []).map((p) => (
              <tr key={p.id ?? `default-${p.severity}-${p.module ?? ""}`}>
                <td><StatusBadge status={p.severity}>{p.severity}</StatusBadge></td>
                <td>{p.module ? formatModuleName(p.module) : "All modules"}</td>
                <td className="aurora-number">{mins(p.ack_minutes)}</td>
                <td className="aurora-number">{mins(p.resolve_minutes)}</td>
                <td className="aurora-number">{p.at_risk_pct}%</td>
                <td>{p.business_hours ? "Yes" : "No"}</td>
                <td>{p.is_default ? <Chip>Default</Chip> : null}</td>
                {write ? (
                  <td><Stack direction="row" gap={1}>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>{p.is_default ? "Override" : "Edit"}</Button>
                    {p.id ? <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => p.id && remove.mutate(p.id)}>Delete</Button> : null}
                  </Stack></td>
                ) : null}
              </tr>
            ))}</tbody>
          </table>
        )}
      <Drawer open={!!editing} onClose={() => setEditing(null)} ariaLabel="SLA policy" header={<Text variant="text-lead">{editing === "new" ? "New policy" : "Edit policy"}</Text>}>
        {editing ? <PolicyForm policy={editing === "new" ? null : editing} onDone={() => setEditing(null)} /> : null}
      </Drawer>
    </Section>
  );
}

function PolicyForm({ policy, onDone }: { policy: SlaPolicy | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [policySeverity, setPolicySeverity] = useState<TriageSeverity>(policy?.severity ?? "high");
  const [policyModule, setPolicyModule] = useState(policy?.module ?? "");
  const [ack, setAck] = useState(policy?.ack_minutes?.toString() ?? "");
  const [resolve, setResolve] = useState(policy?.resolve_minutes.toString() ?? "");
  const [risk, setRisk] = useState(String(policy?.at_risk_pct ?? 80));
  const [business, setBusiness] = useState(policy?.business_hours ?? false);
  const valid = Number(resolve) > 0 && (ack === "" || Number(ack) > 0) && Number(risk) >= 1 && Number(risk) <= 99;
  const save = useMutation({
    mutationFn: () => saveSlaPolicy({
      severity: policySeverity, module: policyModule.trim() || null, ack_minutes: ack === "" ? null : Number(ack),
      resolve_minutes: Number(resolve), at_risk_pct: Number(risk), business_hours: business,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["triage.sla"] }); toast.success("Policy saved"); onDone(); },
    onError: (e) => toast.error(errText(e, "Policy not saved")),
  });
  return (
    <Stack gap={3}>
      <Field label="Severity" required>
        {({ controlId }) => <Select id={controlId} options={SEVERITIES.map((s) => ({ value: s, label: s }))} value={policySeverity} onValueChange={(v) => setPolicySeverity(SEVERITIES.find((s) => s === v) ?? "high")} />}
      </Field>
      <Field label="Module" helper="Module id such as material_master. Leave blank for all modules.">{({ controlId }) => <Input id={controlId} value={policyModule} onChange={(e) => setPolicyModule(e.target.value)} />}</Field>
      <Field label="Acknowledge within (minutes)" helper="Leave blank for no acknowledge target.">{({ controlId }) => <Input id={controlId} type="number" min={1} value={ack} onChange={(e) => setAck(e.target.value)} />}</Field>
      <Field label="Resolve within (minutes)" required>{({ controlId }) => <Input id={controlId} type="number" min={1} value={resolve} onChange={(e) => setResolve(e.target.value)} />}</Field>
      <Field label="At risk after (% of window)">{({ controlId }) => <Input id={controlId} type="number" min={1} max={99} value={risk} onChange={(e) => setRisk(e.target.value)} />}</Field>
      <label><input type="checkbox" checked={business} onChange={(e) => setBusiness(e.target.checked)} /> Count business hours only</label>
      <Stack direction="row" gap={2}>
        <Button disabled={save.isPending || !valid} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save policy"}</Button>
        <Button variant="ghost" onClick={onDone}>Close without saving</Button>
      </Stack>
    </Stack>
  );
}

/* ---------- Calendar settings ---------- */

function CalendarSection({ write }: { write: boolean }) {
  const settings = useQuery({ queryKey: ["triage.settings"], queryFn: getTriageSettings });
  return (
    <Section id="triage-calendar" title="Working calendar">
      {settings.data ? <CalendarForm key={settings.dataUpdatedAt} initial={settings.data} write={write} />
        : <Text tone="muted">{settings.isError ? "Settings could not be read." : "Reading settings."}</Text>}
    </Section>
  );
}

function CalendarForm({ initial, write }: { initial: TriageSettings; write: boolean }) {
  const qc = useQueryClient();
  const { users } = useUsers();
  const [timezone, setTimezone] = useState(initial.timezone);
  const [days, setDays] = useState(initial.work_days);
  const [start, setStart] = useState(initial.work_start.slice(0, 5));
  const [end, setEnd] = useState(initial.work_end.slice(0, 5));
  const [holidays, setHolidays] = useState(initial.holidays.join("\n"));
  const [fallback, setFallback] = useState(initial.fallback_user_id ?? "");
  const badDates = useMemo(() => list(holidays).filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d)), [holidays]);
  const save = useMutation({
    // PUT replaces the whole calendar, so every field goes up.
    mutationFn: () => saveTriageSettings({
      timezone: timezone.trim(), work_days: [...days].sort((a, b) => a - b), work_start: `${start}:00`, work_end: `${end}:00`,
      holidays: list(holidays), fallback_user_id: fallback || null,
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["triage.settings"] }); toast.success("Calendar saved"); },
    onError: (e) => toast.error(errText(e, "Calendar not saved")),
  });
  return (
    <Stack gap={3}>
      {!write ? <Banner tone="info" title="Read only">Changing the calendar needs the manage settings permission.</Banner> : null}
      <Stack direction="row" gap={3} wrap className="ui-fields">
        <Field label="Timezone" helper="IANA name, such as Africa/Johannesburg.">{({ controlId }) => <Input id={controlId} value={timezone} disabled={!write} onChange={(e) => setTimezone(e.target.value)} />}</Field>
        <Field label="Day starts">{({ controlId }) => <Input id={controlId} type="time" value={start} disabled={!write} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Day ends">{({ controlId }) => <Input id={controlId} type="time" value={end} disabled={!write} onChange={(e) => setEnd(e.target.value)} />}</Field>
        <Field label="Fallback user" helper="Gets items no rule matches.">
          {({ controlId }) => <Select id={controlId} disabled={!write} options={[{ value: "", label: "Nobody" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} value={fallback} onValueChange={setFallback} />}
        </Field>
      </Stack>
      <Stack gap={1}>
        <Text variant="text-small">Work days</Text>
        <Stack direction="row" gap={2} wrap>
          {DAYS.map((d, i) => <Chip key={d} selected={days.includes(i + 1)} onClick={write ? () => setDays((xs) => toggled(xs, i + 1, !xs.includes(i + 1))) : undefined}>{d}</Chip>)}
        </Stack>
      </Stack>
      <Field label="Holidays" helper={badDates.length ? `Not a date: ${badDates.join(", ")}` : "One date per line, as YYYY-MM-DD."}>
        {({ controlId }) => <Textarea id={controlId} rows={4} value={holidays} disabled={!write} onChange={(e) => setHolidays(e.target.value)} />}
      </Field>
      {write ? (
        <Stack direction="row">
          <Button disabled={save.isPending || !days.length || !timezone.trim() || !start || !end || badDates.length > 0} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save calendar"}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
}
