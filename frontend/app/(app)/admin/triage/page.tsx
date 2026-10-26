"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Checkbox, ChoiceGroup, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, Input, Notice, PageHeader, Pill, Select, Skeleton, Stat, Status, Textarea, toast } from "@/design";
import { LedgerHead, RowButton } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import {
  createRule, createTeam, deleteRule, deleteSlaPolicy, deleteTeam, getRules, getSlaPolicies, getTeams, getTriageSettings,
  reorderRules, saveSlaPolicy, saveTriageSettings, setTeamMembers, updateRule, updateTeam,
  type AssignmentRule, type RuleMatch, type SlaPolicy, type TeamStrategy, type TriageSettings, type TriageSeverity, type TriageTeam,
} from "@/lib/api/triage";
import { getAssignableUsers } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, isValidTimeZone, labelOf } from "@/lib/format";
import { timezoneOptions } from "@/lib/preferences";
import { queryKeys } from "@/lib/query-keys";

type User = { id: string; name: string; email: string };
const SEVERITIES: TriageSeverity[] = ["critical", "high", "medium", "low"];
const STRATEGIES = [{ value: "round_robin", label: "Round robin" }, { value: "least_loaded", label: "Least loaded" }];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MATCH_FIELDS = [
  ["module", "Objects"], ["check_id", "Check ids"], ["dimension", "Dimensions"],
  ["company_code", "Company codes"], ["plant", "Plants"], ["sales_org", "Sales orgs"],
] as const;
type ListField = (typeof MATCH_FIELDS)[number][0];

const errText = (e: unknown, fallback: string) => apiErrorMessage(e) || fallback;
const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const toggled = <T,>(xs: T[], x: T, on: boolean) => (on ? [...xs, x] : xs.filter((y) => y !== x));
const mins = (m: number | null) => (m == null ? "None" : m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`);

function useUsers() {
  const { can } = useRole();
  const q = useQuery({ queryKey: queryKeys.usersAssignable(), queryFn: getAssignableUsers, enabled: can("assign") });
  const users: User[] = q.data ?? [];
  const name = (id: string | null) => (!id ? "None" : users.find((u) => u.id === id)?.name ?? id.slice(0, 8));
  return { users, name, isError: q.isError, error: q.error, refetch: q.refetch };
}

function Section({ title, action, children, id }: { title: string; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section aria-label={title} id={id} className="scroll-mt-24">
      <LedgerHead title={title} action={action} />
      {children}
    </section>
  );
}

export default function AdminTriagePage() {
  const { can } = useRole();
  const rules = can("manage_rules");
  const settings = can("manage_settings");
  const teams = useQuery({ queryKey: queryKeys.triageTeams(), queryFn: getTeams });
  const ruleQ = useQuery({ queryKey: queryKeys.triageRules(), queryFn: getRules });
  const sla = useQuery({ queryKey: queryKeys.triageSla(), queryFn: getSlaPolicies });
  const usersQ = useUsers();
  const idle = (ruleQ.data ?? []).filter((r) => !r.enabled).length;

  if (teams.isError || ruleQ.isError || sla.isError || usersQ.isError) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorState
          message={errText(teams.error ?? ruleQ.error ?? sla.error ?? usersQ.error, "Triage could not be read")}
          onRetry={() => { teams.refetch(); ruleQ.refetch(); sla.refetch(); usersQ.refetch(); }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" aria-busy={teams.isLoading || undefined}>
      <PageHeader title="Triage" meta="Who gets each new issue, how long they have to fix it, and the working days the clock counts. These drive the urgency colours in the inbox" />

      <div className="flex gap-4">
        <Stat label="Rules switched off" value={idle} tone={idle ? "at-risk" : undefined} loading={ruleQ.isLoading} delta={`of ${ruleQ.data?.length ?? 0} assignment rules`} />
      </div>

      {!rules && !settings ? (
        <Notice tone="info">You can read these settings. Ask an administrator to change teams, rules, deadlines or the calendar.</Notice>
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
  const teams = useQuery({ queryKey: queryKeys.triageTeams(), queryFn: getTeams });
  const [editing, setEditing] = useState<TriageTeam | "new" | null>(null);
  const [deleting, setDeleting] = useState<TriageTeam | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.triageTeams() }); toast.success("Team deleted"); setDeleting(null); },
    onError: (e) => toast.error(errText(e, "Team not deleted")),
  });

  const teamCols: ColumnDef<TriageTeam, unknown>[] = [
    { id: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "strategy", header: "Strategy", cell: ({ row }) => STRATEGIES.find((x) => x.value === row.original.strategy)?.label ?? row.original.strategy },
    { id: "lead", header: "Lead", cell: ({ row }) => users.find((u) => u.id === row.original.lead_user_id)?.name ?? "None" },
    { id: "members", header: "Members", cell: ({ row }) => <span title={row.original.member_ids.map((id) => users.find((u) => u.id === id)?.name ?? id).join(", ")}>{row.original.member_ids.length}</span> },
    { id: "open", header: "Open items", cell: ({ row }) => row.original.open_items },
    {
      id: "act", header: "Action",
      cell: ({ row }) => write ? (
        <span className="flex gap-2">
          <RowButton onClick={() => setEditing(row.original)}>Edit</RowButton>
          <RowButton onClick={() => setDeleting(row.original)}>Delete</RowButton>
        </span>
      ) : null,
    },
  ];

  return (
    <Section title="Teams" action={write ? <Button variant="secondary" onClick={() => setEditing("new")}>Add team</Button> : undefined}>
      {teams.isError ? (
        <ErrorState message={errText(teams.error, "Teams could not be read")} onRetry={() => teams.refetch()} />
      ) : teams.isLoading ? (
        <Skeleton height={120} />
      ) : !teams.data?.length ? (
        <EmptyState title="No teams yet" detail="Teams let assignment rules route new items to a group." action={write ? <Button onClick={() => setEditing("new")}>Add team</Button> : undefined} />
      ) : (
        <DataTable columns={teamCols} data={teams.data} getRowId={(t) => t.id} />
      )}
      {editing ? <TeamForm team={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Delete this team"
        body="Assignment rules that route to this team stop matching. Open items stay where they are."
        confirmLabel="Delete team"
        tone="danger"
        typeToConfirm={deleting?.name ?? ""}
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.triageTeams() }); toast.success("Team saved"); onClose(); },
    onError: (e) => toast.error(errText(e, "Team not saved")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={team ? "Edit team" : "Add team"}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Strategy"><Select value={strategy} onValueChange={(v) => setStrategy(v as TeamStrategy)} options={STRATEGIES} /></Field>
        <Field label="Lead">
          <Select value={lead} onValueChange={setLead} options={[{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
        </Field>
        <Field label="Members">
          <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 m-text-body">
                <Checkbox
                  aria-label={u.name}
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

/** A rule's match in words: every condition it narrows on, severity included; objects by name, never by id. */
export function matchText(m: RuleMatch): string {
  const parts = MATCH_FIELDS.filter(([k]) => m[k]?.length).map(([k, label]) => `${label}: ${m[k]!.map((v) => (k === "module" ? formatModuleName(v) : v)).join(", ")}`);
  if (m.severity?.length) parts.unshift(`Severity: ${m.severity.map(labelOf).join(", ")}`);
  return parts.length ? parts.join("; ") : "Matches everything";
}

function RulesSection({ write }: { write: boolean }) {
  const qc = useQueryClient();
  const { name } = useUsers();
  const teams = useQuery({ queryKey: queryKeys.triageTeams(), queryFn: getTeams });
  const ruleQ = useQuery({ queryKey: queryKeys.triageRules(), queryFn: getRules });
  const [editing, setEditing] = useState<AssignmentRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<AssignmentRule | null>(null);
  const teamName = (id: string | null) => (!id ? null : teams.data?.find((t) => t.id === id)?.name ?? id.slice(0, 8));
  const target = (r: AssignmentRule) => (r.assign_team_id ? `Team: ${teamName(r.assign_team_id)}` : r.assign_user_id ? `User: ${name(r.assign_user_id)}` : "Fallback user");

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.triageRules() });
  const toggle = useMutation({
    mutationFn: (r: AssignmentRule) => updateRule(r.id, { name: r.name, match: r.match, assign_user_id: r.assign_user_id, assign_team_id: r.assign_team_id, enabled: !r.enabled, position: r.position }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errText(e, "Rule not updated")),
  });
  const move = useMutation({
    mutationFn: (ids: string[]) => reorderRules(ids),
    onSuccess: invalidate,
    onError: (e) => toast.error(errText(e, "Rules not reordered")),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess: () => { invalidate(); toast.success("Rule deleted"); setDeleting(null); },
    onError: (e) => toast.error(errText(e, "Rule not deleted")),
  });

  const sorted = [...(ruleQ.data ?? [])].sort((a, b) => a.position - b.position);
  const swap = (i: number, j: number) => {
    const ids = sorted.map((r) => r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    move.mutate(ids);
  };

  const ruleCols: ColumnDef<AssignmentRule, unknown>[] = [
    { id: "n", header: "#", cell: ({ row }) => <span className="m-numeric m-text-meta">{row.index + 1}</span> },
    { id: "name", header: "Name", cell: ({ row }) => row.original.name },
    { id: "match", header: "Matches", cell: ({ row }) => <span className="m-ink-3">{matchText(row.original.match)}</span> },
    { id: "to", header: "Assigns to", cell: ({ row }) => target(row.original) },
    { id: "on", header: "Enabled", cell: ({ row }) => <Checkbox checked={row.original.enabled} disabled={!write} onChange={() => toggle.mutate(row.original)} aria-label={`${row.original.name} enabled`} /> },
    {
      id: "act", header: "Action",
      cell: ({ row }) => write ? (
        <span className="flex gap-1">
          <RowButton disabled={row.index === 0} onClick={() => swap(row.index, row.index - 1)}>Up</RowButton>
          <RowButton disabled={row.index === sorted.length - 1} onClick={() => swap(row.index, row.index + 1)}>Down</RowButton>
          <RowButton onClick={() => setEditing(row.original)}>Edit</RowButton>
          <RowButton onClick={() => setDeleting(row.original)}>Delete</RowButton>
        </span>
      ) : null,
    },
  ];

  return (
    <Section title="Assignment rules" action={write ? <Button variant="secondary" onClick={() => setEditing("new")}>Add rule</Button> : undefined}>
      {ruleQ.isError ? (
        <ErrorState message={errText(ruleQ.error, "Rules could not be read")} onRetry={() => ruleQ.refetch()} />
      ) : ruleQ.isLoading ? (
        <Skeleton height={120} />
      ) : !sorted.length ? (
        <EmptyState title="No rules yet" detail="New items go to the fallback user." action={write ? <Button onClick={() => setEditing("new")}>Add rule</Button> : undefined} />
      ) : (
        <DataTable columns={ruleCols} data={sorted} getRowId={(r) => r.id} />
      )}
      {editing ? <RuleForm rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Delete this assignment rule"
        body="New items stop matching it and fall through to the next rule."
        confirmLabel="Delete rule"
        tone="danger"
        typeToConfirm={deleting?.name ?? ""}
        pending={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </Section>
  );
}

function RuleForm({ rule, onClose }: { rule: AssignmentRule | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { users } = useUsers();
  const teams = useQuery({ queryKey: queryKeys.triageTeams(), queryFn: getTeams });
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.triageRules() }); toast.success("Rule saved"); onClose(); },
    onError: (e) => toast.error(errText(e, "Rule not saved")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={rule ? "Edit rule" : "Add rule"}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
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
          <ChoiceGroup
            multiple
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={SEVERITIES.map((s) => ({ value: s, label: labelOf(s) }))}
          />
        </Field>
        {MATCH_FIELDS.map(([k, label]) => (
          <Field key={k} label={`${label} (comma-separated)`}>
            <Input value={fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
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
  const sla = useQuery({ queryKey: queryKeys.triageSla(), queryFn: getSlaPolicies });
  const [editing, setEditing] = useState<SlaPolicy | "new" | null>(null);
  const [deleting, setDeleting] = useState<SlaPolicy | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => deleteSlaPolicy(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.triageSla() }); toast.success("Policy deleted"); setDeleting(null); },
    onError: (e) => toast.error(errText(e, "Policy not deleted")),
  });

  const slaCols: ColumnDef<SlaPolicy, unknown>[] = [
    { id: "sev", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
    { id: "mod", header: "Object", cell: ({ row }) => (row.original.module ? formatModuleName(row.original.module) : "All objects") },
    { id: "ack", header: "Acknowledge", cell: ({ row }) => mins(row.original.ack_minutes) },
    { id: "res", header: "Resolve", cell: ({ row }) => mins(row.original.resolve_minutes) },
    { id: "risk", header: "At-risk", cell: ({ row }) => `${row.original.at_risk_pct}%` },
    { id: "hrs", header: "Hours", cell: ({ row }) => (row.original.business_hours ? "Business hours" : "Calendar hours") },
    { id: "src", header: "Source", cell: ({ row }) => (row.original.is_default ? <Pill tone="neutral">Default</Pill> : "Saved") },
    {
      id: "act", header: "Action",
      cell: ({ row }) => write ? (
        <span className="flex gap-1">
          <RowButton onClick={() => setEditing(row.original)}>{row.original.is_default ? "Override" : "Edit"}</RowButton>
          {row.original.id ? <RowButton onClick={() => setDeleting(row.original)}>Delete</RowButton> : null}
        </span>
      ) : null,
    },
  ];

  return (
    <Section title="SLA policies" action={write ? <Button variant="secondary" onClick={() => setEditing("new")}>Add override</Button> : undefined}>
      {sla.isError ? (
        <ErrorState message={errText(sla.error, "Policies could not be read")} onRetry={() => sla.refetch()} />
      ) : sla.isLoading ? (
        <Skeleton height={160} />
      ) : (
        <DataTable columns={slaCols} data={sla.data ?? []} getRowId={(p) => `${p.severity}-${p.module ?? ""}`} />
      )}
      {editing ? <PolicyForm policy={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Delete this SLA override"
        body="Items of this severity go back to the default policy."
        confirmLabel="Delete override"
        tone="danger"
        typeToConfirm={deleting?.severity ?? ""}
        pending={del.isPending}
        onConfirm={() => { if (deleting?.id) del.mutate(deleting.id); }}
      />
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.triageSla() }); toast.success("Policy saved"); onClose(); },
    onError: (e) => toast.error(errText(e, "Policy not saved")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={policy ? "Edit SLA policy" : "Add SLA override"}>
      <div className="flex flex-col gap-3">
        <Field label="Severity">
          <Select value={severity} onValueChange={(v) => setSeverity(v as TriageSeverity)} options={SEVERITIES.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Object (blank = all objects)"><Input value={module} onChange={(e) => setModule(e.target.value)} /></Field>
        <Field label="Acknowledge minutes (optional)"><Input type="number" min="0" value={ack} onChange={(e) => setAck(e.target.value)} /></Field>
        <Field label="Resolve minutes"><Input type="number" min="1" value={resolve} onChange={(e) => setResolve(e.target.value)} /></Field>
        <Field label="At-risk %"><Input type="number" min="1" max="99" value={atRisk} onChange={(e) => setAtRisk(e.target.value)} /></Field>
        <label className="flex items-center gap-2 m-text-body">
          <Checkbox aria-label="Business hours only" checked={businessHours} onChange={(e) => setBusinessHours(e.target.checked)} />
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
  const settings = useQuery({ queryKey: queryKeys.triageSettings(), queryFn: getTriageSettings });
  if (settings.isError) {
    return (
      <Section title="Working calendar">
        <ErrorState message={errText(settings.error, "The calendar could not be read")} onRetry={() => settings.refetch()} />
      </Section>
    );
  }
  if (settings.isLoading) return <Section title="Working calendar"><Skeleton height={160} /></Section>;
  return (
    <Section title="Working calendar" id="calendar">
      {!write ? (
        <Notice tone="info">Changing the calendar needs the manage settings permission.</Notice>
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
  const [confirmZone, setConfirmZone] = useState(false);
  // Only IANA zones are accepted; a stored zone the browser does not know stays listed so the admin sees it, flagged.
  const zoneError = isValidTimeZone(timezone) ? undefined : `${timezone || "This"} is not a recognised time zone. Pick one from the list`;
  const zones = useMemo(() => {
    const all = timezoneOptions();
    const own = timezone && !all.includes(timezone) ? [timezone] : [];
    return [...own, ...all].map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
  }, [timezone]);
  const zoneChanged = timezone !== settings.timezone;

  const save = useMutation({
    mutationFn: () => saveTriageSettings({
      timezone, work_days: workDays, work_start: workStart, work_end: workEnd,
      holidays: list(holidaysText), fallback_user_id: fallback || null,
    }),
    onSuccess: () => { setConfirmZone(false); qc.invalidateQueries({ queryKey: queryKeys.triageSettings() }); toast.success("Calendar saved"); },
    onError: (e) => toast.error(errText(e, "Calendar not saved")),
  });
  const submit = () => (zoneChanged ? setConfirmZone(true) : save.mutate());

  return (
    <div className="flex flex-col gap-3 max-w-[480px]">
      <div className="flex flex-col gap-1">
        <Field label="Time zone" error={zoneError}>
          {write
            ? <Select value={timezone} onValueChange={setTimezone} options={zones} placeholder="Pick a time zone" />
            : <Input value={timezone} disabled readOnly />}
        </Field>
        <p className="m-text-meta m-ink-3">Extraction schedules, SLA clocks and dates for anyone without a zone of their own use this zone</p>
      </div>
      <Field label="Work days">
        <ChoiceGroup
          multiple
          label="Work days"
          disabled={!write}
          value={workDays.map(String)}
          onChange={(days) => setWorkDays(days.map(Number))}
          options={DAYS.map((label, i) => ({ value: String(i + 1), label }))}
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Day starts"><Input type="time" value={workStart} disabled={!write} onChange={(e) => setWorkStart(e.target.value)} /></Field>
        <Field label="Day ends"><Input type="time" value={workEnd} disabled={!write} onChange={(e) => setWorkEnd(e.target.value)} /></Field>
      </div>
      <Field label="Fallback user">
        <Select value={fallback} onValueChange={setFallback} options={[{ value: "", label: "None" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />
      </Field>
      <Field label="Holidays (YYYY-MM-DD, one per line)" error={badDates.length ? `Not a date: ${badDates.join(", ")}` : undefined}>
        <Textarea rows={4} value={holidaysText} disabled={!write} onChange={(e) => setHolidaysText(e.target.value)} />
      </Field>
      {write ? (
        <div>
          <Button disabled={!!badDates.length || !!zoneError || save.isPending} onClick={submit}>{save.isPending ? "Saving…" : "Save calendar"}</Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmZone}
        onOpenChange={setConfirmZone}
        title="Change the time zone"
        body={`Every extraction schedule will run in ${timezone.replace(/_/g, " ")} instead of ${settings.timezone.replace(/_/g, " ")}, so a daily 02:00 extract moves to 02:00 there. SLA clocks and default dates follow too.`}
        confirmLabel="Change time zone"
        cancelLabel="Keep current zone"
        pending={save.isPending}
        onConfirm={() => save.mutate()}
      />
    </div>
  );
}
