"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Dialog, Field, Pill, Select } from "@/design";
import { useRole } from "@/hooks/use-role";
import {
  createRule, createTeam, deleteRule, deleteSlaPolicy, deleteTeam, getRules, getSlaPolicies, getTeams, getTriageSettings,
  reorderRules, saveSlaPolicy, saveTriageSettings, setTeamMembers, updateRule, updateTeam,
  type AssignmentRule, type RuleMatch, type SlaPolicy, type TeamStrategy, type TriageSettings, type TriageSeverity, type TriageTeam,
} from "@/lib/api/triage";
import { getAssignableUsers } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName, labelOf } from "@/lib/format";

type User = { id: string; name: string; email: string };
const SEVERITIES: TriageSeverity[] = ["critical", "high", "medium", "low"];
const STRATEGIES = [{ value: "round_robin", label: "Round robin" }, { value: "least_loaded", label: "Least loaded" }];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MATCH_FIELDS = [
  ["module", "Modules"], ["check_id", "Check ids"], ["dimension", "Dimensions"],
  ["company_code", "Company codes"], ["plant", "Plants"], ["sales_org", "Sales orgs"],
] as const;
type ListField = (typeof MATCH_FIELDS)[number][0];

const errText = (e: unknown, fallback: string) => apiErrorMessage(e) || fallback;
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

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="px-2 py-0.5 text-[12px] leading-4 rounded-full border"
      style={{
        color: active ? "var(--m-pass)" : "var(--m-ink-3)",
        borderColor: active ? "var(--m-pass)" : "var(--m-line)",
        background: active ? "var(--m-sheet-raised)" : "var(--m-sheet)",
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function AdminTriagePage() {
  const { can } = useRole();
  const rules = can("manage_rules");
  const settings = can("manage_settings");
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const ruleQ = useQuery({ queryKey: ["triage.rules"], queryFn: getRules });
  const sla = useQuery({ queryKey: ["triage.sla"], queryFn: getSlaPolicies });
  const idle = (ruleQ.data ?? []).filter((r) => !r.enabled).length;
  const custom = (sla.data ?? []).filter((p) => !p.is_default).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <strong className="text-[17px]">Triage</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          Who gets new issues, how long they have, and the calendar the clocks run on.
        </p>
      </header>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Teams</span>
          <span className="text-[18px] font-semibold">{teams.isLoading ? "–" : teams.data?.length ?? 0}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
            {teams.data?.length ? "Rules can route to a team." : "No team to route to yet."}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Assignment rules</span>
          <span className="text-[18px] font-semibold" style={{ color: idle ? "var(--m-medium)" : undefined }}>
            {ruleQ.isLoading ? "–" : ruleQ.data?.length ?? 0}
          </span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
            {idle ? `${idle} switched off.` : ruleQ.data?.length ? "Every rule is active." : "Items go to the fallback user."}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>SLA policies</span>
          <span className="text-[18px] font-semibold">{sla.isLoading ? "–" : custom}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{custom ? "Saved by you." : "Defaults apply."}</span>
        </div>
      </div>

      {!rules && !settings ? (
        <div className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-line)", color: "var(--m-ink-3)" }}>
          Changing triage needs the manage rules or manage settings permission.
        </div>
      ) : null}

      <TeamsSection write={rules} />
      <RulesSection write={rules} />
      <PoliciesSection write={rules} />
      <CalendarSection write={settings} />
    </div>
  );
}

// ---------------------------------------------------------------- Teams

function TeamsSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const { users } = useUsers();
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const [editing, setEditing] = useState<TriageTeam | "new" | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["triage.teams"] }); toast.success("Team deleted"); },
    onError: (e) => toast.error(errText(e, "Team not deleted.")),
  });

  return (
    <Section title="Teams" action={write ? <Button variant="secondary" onClick={() => setEditing("new")}>Add team</Button> : undefined}>
      {teams.isLoading ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Reading teams.</p>
      ) : !teams.data?.length ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No teams yet.</p>
      ) : (
        <table className="text-[13px] w-full">
          <thead>
            <tr>
              <th className="text-left">Name</th><th className="text-left">Strategy</th><th className="text-left">Lead</th>
              <th className="text-left">Members</th><th className="text-left">Open items</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {teams.data.map((t) => (
              <tr key={t.id}>
                <td className="py-1">{t.name}</td>
                <td>{STRATEGIES.find((s) => s.value === t.strategy)?.label ?? t.strategy}</td>
                <td>{users.find((u) => u.id === t.lead_user_id)?.name ?? "None"}</td>
                <td title={t.member_ids.map((id) => users.find((u) => u.id === id)?.name ?? id).join(", ")}>{t.member_ids.length}</td>
                <td>{t.open_items}</td>
                <td className="flex gap-2">
                  {write ? <Button variant="ghost" onClick={() => setEditing(t)}>Edit</Button> : null}
                  {write ? (
                    <Button variant="ghost" onClick={() => { if (window.confirm(`Delete team "${t.name}"?`)) del.mutate(t.id); }}>
                      Delete
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? <TeamForm team={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

function TeamForm({ team, onClose }: { team: TriageTeam | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { users } = useUsers();
  const [name, setName] = useState(team?.name ?? "");
  const [strategy, setStrategy] = useState<TeamStrategy>(team?.strategy ?? "round_robin");
  const [lead, setLead] = useState(team?.lead_user_id ?? "");
  const [members, setMembers] = useState<string[]>(team?.member_ids ?? []);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, strategy, lead_user_id: lead || null };
      if (team) {
        await updateTeam(team.id, body);
        await setTeamMembers(team.id, members);
      } else {
        await createTeam({ ...body, member_ids: members });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["triage.teams"] }); toast.success("Team saved"); onClose(); },
    onError: (e) => toast.error(errText(e, "Team not saved.")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={team ? "Edit team" : "Add team"}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Strategy"><Select value={strategy} onValueChange={(v) => setStrategy(v as TeamStrategy)} options={STRATEGIES} /></Field>
        <Field label="Lead">
          <Select value={lead} onValueChange={setLead} options={[{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        </Field>
        <Field label="Members">
          <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={members.includes(u.id)}
                  onChange={(e) => setMembers(toggled(members, u.id, e.target.checked))}
                />
                {u.name}
              </label>
            ))}
          </div>
        </Field>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Discard draft</Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Rules

function matchText(m: RuleMatch): string {
  const parts = MATCH_FIELDS.filter(([k]) => m[k]?.length).map(([k, label]) => `${label}: ${m[k]!.join(", ")}`);
  return parts.length ? parts.join("; ") : "Matches everything";
}

function RulesSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const { name } = useUsers();
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const ruleQ = useQuery({ queryKey: ["triage.rules"], queryFn: getRules });
  const [editing, setEditing] = useState<AssignmentRule | "new" | null>(null);
  const teamName = (id: string | null) => (!id ? null : teams.data?.find((t) => t.id === id)?.name ?? id.slice(0, 8));
  const target = (r: AssignmentRule) => (r.assign_team_id ? `Team: ${teamName(r.assign_team_id)}` : r.assign_user_id ? `User: ${name(r.assign_user_id)}` : "Fallback user");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["triage.rules"] });
  const toggle = useMutation({
    mutationFn: (r: AssignmentRule) => updateRule(r.id, { name: r.name, match: r.match, assign_user_id: r.assign_user_id, assign_team_id: r.assign_team_id, enabled: !r.enabled, position: r.position }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errText(e, "Rule not updated.")),
  });
  const move = useMutation({
    mutationFn: (ids: string[]) => reorderRules(ids),
    onSuccess: invalidate,
    onError: (e) => toast.error(errText(e, "Rules not reordered.")),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess: () => { invalidate(); toast.success("Rule deleted"); },
    onError: (e) => toast.error(errText(e, "Rule not deleted.")),
  });

  const sorted = [...(ruleQ.data ?? [])].sort((a, b) => a.position - b.position);
  const swap = (i: number, j: number) => {
    const ids = sorted.map((r) => r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    move.mutate(ids);
  };

  return (
    <Section title="Assignment rules" action={write ? <Button variant="secondary" onClick={() => setEditing("new")}>Add rule</Button> : undefined}>
      {ruleQ.isLoading ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Reading rules.</p>
      ) : !sorted.length ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No rules yet. New items go to the fallback user.</p>
      ) : (
        <table className="text-[13px] w-full">
          <thead>
            <tr>
              <th className="text-left">#</th><th className="text-left">Name</th><th className="text-left">Matches</th>
              <th className="text-left">Assigns to</th><th className="text-left">Enabled</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.id}>
                <td className="font-mono text-[12px]">{i + 1}</td>
                <td className="py-1">{r.name}</td>
                <td style={{ color: "var(--m-ink-3)" }}>{matchText(r.match)}</td>
                <td>{target(r)}</td>
                <td>
                  <input type="checkbox" checked={r.enabled} disabled={!write} onChange={() => toggle.mutate(r)} aria-label={`${r.name} enabled`} />
                </td>
                <td className="flex gap-1">
                  {write ? <Button variant="ghost" disabled={i === 0} onClick={() => swap(i, i - 1)}>Up</Button> : null}
                  {write ? <Button variant="ghost" disabled={i === sorted.length - 1} onClick={() => swap(i, i + 1)}>Down</Button> : null}
                  {write ? <Button variant="ghost" onClick={() => setEditing(r)}>Edit</Button> : null}
                  {write ? (
                    <Button variant="ghost" onClick={() => { if (window.confirm(`Delete rule "${r.name}"?`)) del.mutate(r.id); }}>Delete</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

function RuleForm({ rule, onClose }: { rule: AssignmentRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { users } = useUsers();
  const teams = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const [name, setName] = useState(rule?.name ?? "");
  const [assignee, setAssignee] = useState(rule?.assign_team_id ? `team:${rule.assign_team_id}` : rule?.assign_user_id ? `user:${rule.assign_user_id}` : "");
  const [severity, setSeverity] = useState<TriageSeverity[]>(rule?.match.severity ?? []);
  const [fields, setFields] = useState<Record<ListField, string>>(() => {
    const init = {} as Record<ListField, string>;
    for (const [k] of MATCH_FIELDS) init[k] = (rule?.match[k] ?? []).join(", ");
    return init;
  });

  const save = useMutation({
    mutationFn: () => {
      const match: RuleMatch = {};
      for (const [k] of MATCH_FIELDS) { const v = list(fields[k]); if (v.length) match[k] = v; }
      if (severity.length) match.severity = severity;
      const [kind, id] = assignee.split(":");
      const body = {
        name, match,
        assign_user_id: kind === "user" ? id : null,
        assign_team_id: kind === "team" ? id : null,
        enabled: rule?.enabled ?? true,
      };
      return rule ? updateRule(rule.id, { ...body, position: rule.position }) : createRule(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["triage.rules"] }); toast.success("Rule saved"); onClose(); },
    onError: (e) => toast.error(errText(e, "Rule not saved.")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={rule ? "Edit rule" : "Add rule"}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Assign to">
          <Select
            value={assignee}
            onValueChange={setAssignee}
            options={[
              { value: "", label: "Fallback user" },
              ...users.map((u) => ({ value: `user:${u.id}`, label: `User: ${u.name}` })),
              ...(teams.data ?? []).map((t) => ({ value: `team:${t.id}`, label: `Team: ${t.name}` })),
            ]}
          />
        </Field>
        <Field label="Severity">
          <div className="flex gap-2">
            {SEVERITIES.map((s) => (
              <Toggle key={s} active={severity.includes(s)} onClick={() => setSeverity(toggled(severity, s, !severity.includes(s)))}>{s}</Toggle>
            ))}
          </div>
        </Field>
        {MATCH_FIELDS.map(([k, label]) => (
          <Field key={k} label={`${label} (comma-separated)`}>
            <input value={fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
          </Field>
        ))}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Discard draft</Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- SLA policies

function PoliciesSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const sla = useQuery({ queryKey: ["triage.sla"], queryFn: getSlaPolicies });
  const [editing, setEditing] = useState<SlaPolicy | "new" | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deleteSlaPolicy(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["triage.sla"] }); toast.success("Policy deleted"); },
    onError: (e) => toast.error(errText(e, "Policy not deleted.")),
  });

  return (
    <Section title="SLA policies" action={write ? <Button variant="secondary" onClick={() => setEditing("new")}>Add override</Button> : undefined}>
      {sla.isLoading ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Reading policies.</p>
      ) : (
        <table className="text-[13px] w-full">
          <thead>
            <tr>
              <th className="text-left">Severity</th><th className="text-left">Module</th><th className="text-left">Acknowledge</th>
              <th className="text-left">Resolve</th><th className="text-left">At-risk</th><th className="text-left">Hours</th>
              <th className="text-left">Source</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {(sla.data ?? []).map((p) => (
              <tr key={`${p.severity}-${p.module ?? ""}`}>
                <td className="py-1"><Pill tone={p.severity === "critical" ? "no-go" : p.severity === "high" ? "at-risk" : "neutral"}>{labelOf(p.severity)}</Pill></td>
                <td>{p.module ? formatModuleName(p.module) : "All modules"}</td>
                <td>{mins(p.ack_minutes)}</td>
                <td>{mins(p.resolve_minutes)}</td>
                <td>{p.at_risk_pct}%</td>
                <td>{p.business_hours ? "Business hours" : "Calendar hours"}</td>
                <td>{p.is_default ? <Pill tone="neutral">Default</Pill> : "Saved"}</td>
                <td className="flex gap-1">
                  {write ? <Button variant="ghost" onClick={() => setEditing(p)}>{p.is_default ? "Override" : "Edit"}</Button> : null}
                  {write && p.id ? (
                    <Button variant="ghost" onClick={() => { if (window.confirm("Delete this override?")) del.mutate(p.id!); }}>Delete</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? <PolicyForm policy={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

function PolicyForm({ policy, onClose }: { policy: SlaPolicy | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<TriageSeverity>(policy?.severity ?? "critical");
  const [module, setModule] = useState(policy?.module ?? "");
  const [ack, setAck] = useState(policy?.ack_minutes != null ? String(policy.ack_minutes) : "");
  const [resolve, setResolve] = useState(policy ? String(policy.resolve_minutes) : "");
  const [atRisk, setAtRisk] = useState(policy ? String(policy.at_risk_pct) : "80");
  const [businessHours, setBusinessHours] = useState(policy?.business_hours ?? true);
  const resolveNum = Number(resolve);
  const atRiskNum = Number(atRisk);
  const valid = resolve.trim() !== "" && resolveNum > 0 && atRiskNum >= 1 && atRiskNum <= 99;

  const save = useMutation({
    mutationFn: () => saveSlaPolicy({
      severity, module: module.trim() || null, ack_minutes: ack.trim() ? Number(ack) : null,
      resolve_minutes: resolveNum, at_risk_pct: atRiskNum, business_hours: businessHours,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["triage.sla"] }); toast.success("Policy saved"); onClose(); },
    onError: (e) => toast.error(errText(e, "Policy not saved.")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={policy ? "Edit SLA policy" : "Add SLA override"}>
      <div className="flex flex-col gap-3">
        <Field label="Severity">
          <Select value={severity} onValueChange={(v) => setSeverity(v as TriageSeverity)} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Module (blank = all modules)"><input value={module} onChange={(e) => setModule(e.target.value)} /></Field>
        <Field label="Acknowledge minutes (optional)"><input type="number" min="0" value={ack} onChange={(e) => setAck(e.target.value)} /></Field>
        <Field label="Resolve minutes"><input type="number" min="1" value={resolve} onChange={(e) => setResolve(e.target.value)} /></Field>
        <Field label="At-risk %"><input type="number" min="1" max="99" value={atRisk} onChange={(e) => setAtRisk(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={businessHours} onChange={(e) => setBusinessHours(e.target.checked)} />
          Business hours only
        </label>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={onClose}>Discard draft</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Calendar

function CalendarSection({ write }: { write: boolean }) {
  const settings = useQuery({ queryKey: ["triage.settings"], queryFn: getTriageSettings });
  if (settings.isLoading) return <Section title="Working calendar"><p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Reading the calendar.</p></Section>;
  return (
    <Section title="Working calendar">
      {!write ? (
        <div className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-line)", color: "var(--m-ink-3)" }}>
          Changing the calendar needs the manage settings permission.
        </div>
      ) : null}
      {settings.data ? <CalendarForm settings={settings.data} write={write} /> : null}
    </Section>
  );
}

function CalendarForm({ settings, write }: { settings: TriageSettings; write: boolean }) {
  const qc = useQueryClient();
  const { users } = useUsers();
  const [timezone, setTimezone] = useState(settings.timezone);
  const [workDays, setWorkDays] = useState<number[]>(settings.work_days);
  const [workStart, setWorkStart] = useState(settings.work_start);
  const [workEnd, setWorkEnd] = useState(settings.work_end);
  const [fallback, setFallback] = useState(settings.fallback_user_id ?? "");
  const [holidaysText, setHolidaysText] = useState(settings.holidays.join("\n"));
  const badDates = list(holidaysText).filter((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d));

  const save = useMutation({
    mutationFn: () => saveTriageSettings({
      timezone, work_days: workDays, work_start: workStart, work_end: workEnd,
      holidays: list(holidaysText), fallback_user_id: fallback || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["triage.settings"] }); toast.success("Calendar saved"); },
    onError: (e) => toast.error(errText(e, "Calendar not saved.")),
  });

  return (
    <div className="flex flex-col gap-3 max-w-[480px]">
      <Field label="Timezone"><input value={timezone} disabled={!write} onChange={(e) => setTimezone(e.target.value)} /></Field>
      <Field label="Work days">
        <div className="flex gap-2">
          {DAYS.map((label, i) => {
            const iso = i + 1;
            return (
              <Toggle key={iso} active={workDays.includes(iso)} onClick={() => write && setWorkDays(toggled(workDays, iso, !workDays.includes(iso)))}>
                {label}
              </Toggle>
            );
          })}
        </div>
      </Field>
      <div className="flex gap-3">
        <Field label="Day starts"><input type="time" value={workStart} disabled={!write} onChange={(e) => setWorkStart(e.target.value)} /></Field>
        <Field label="Day ends"><input type="time" value={workEnd} disabled={!write} onChange={(e) => setWorkEnd(e.target.value)} /></Field>
      </div>
      <Field label="Fallback user">
        <Select value={fallback} onValueChange={setFallback} options={[{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
      </Field>
      <Field label="Holidays (YYYY-MM-DD, one per line)" error={badDates.length ? `Not a date: ${badDates.join(", ")}` : undefined}>
        <textarea rows={4} value={holidaysText} disabled={!write} onChange={(e) => setHolidaysText(e.target.value)} />
      </Field>
      {write ? (
        <div>
          <Button disabled={!!badDates.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save calendar"}</Button>
        </div>
      ) : null}
    </div>
  );
}
