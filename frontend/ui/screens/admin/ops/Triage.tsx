"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createTeam, deleteAssignRule, deleteTeam, getAssignRules, getTeams, setAssignRuleEnabled, type Digest, type SlaPolicy } from "@/lib/api/v2/triage";
import { useFixture } from "@/lib/api/v2/fixture";
import { useAssignable, useDigest, useSaveTriage, useSlaPolicies } from "@/lib/v2/approvals-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Select, Toggle, useToast, EmptyState } from "@/ui/kit";
import { Row, Sec, errText } from "./shared";

export function Triage() {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const sla = useSlaPolicies();
  const digest = useDigest();
  const people = useAssignable(true);
  const teams = useQuery({ queryKey: ["v2", "triage-teams", fx], queryFn: getTeams, retry: false });
  const rules = useQuery({ queryKey: ["v2", "triage-rules", fx], queryFn: getAssignRules, retry: false });
  const save = useSaveTriage();
  const [edit, setEdit] = useState<Record<string, number>>({});
  const [dg, setDg] = useState<Digest | null>(null);
  const [team, setTeam] = useState("");
  const name = (id: string | null) => (id ? people.data?.find((p) => p.id === id)?.name ?? id : "");
  const policies = sla.data ?? [];
  const refetch = () => { qc.invalidateQueries({ queryKey: ["v2", "triage-teams"] }); qc.invalidateQueries({ queryKey: ["v2", "triage-rules"] }); };
  const act = async (fn: () => Promise<unknown>, done: string) => { try { await fn(); toast(done, "good"); refetch(); } catch (e) { toast(errText(e), "bad"); } };
  const key = (p: SlaPolicy) => `${p.severity}/${p.module ?? ""}`;
  const changed = policies.filter((p) => edit[key(p)] !== undefined && edit[key(p)] !== p.resolve_minutes);
  const cur = dg ?? digest.data?.notifications?.digest ?? "off";

  return (
    <Sec title={t("Triage settings")} scope="triage" q={[sla, teams, rules]} context={t("{n} rules, {m} teams", { n: rules.data?.length ?? 0, m: teams.data?.length ?? 0 })}
      facts={[t("{n} assignment rules are set.", { n: rules.data?.length ?? 0 })]}>
      <Card title={t("Time to resolve")} sub={t("Minutes allowed before an item breaches, by severity.")}
        action={<Button variant="primary" disabled={save.isPending || (changed.length === 0 && dg === null)}
          onClick={() => save.mutate({ policies: changed.map((p) => ({ ...p, resolve_minutes: edit[key(p)] })), digest: dg }, { onSuccess: () => { setEdit({}); setDg(null); toast(t("Settings saved."), "good"); }, onError: (e) => toast(errText(e), "bad") })}>{t("Save")}</Button>}>
        <DataTable label={t("Resolve time by severity")} rows={policies} rowKey={key} height={240}
          columns={[
            { key: "sev", label: t("Severity"), render: (p) => <Code code={p.severity} description={p.module ?? t("All objects")} /> },
            { key: "ack", label: t("Acknowledge (min)"), align: "end", render: (p) => String(p.ack_minutes ?? "") },
            { key: "res", label: t("Resolve (min)"), align: "end", render: (p) => (
              <Input aria-label={t("Resolve minutes for {sev}", { sev: p.severity })} inputMode="numeric" value={String(edit[key(p)] ?? p.resolve_minutes)}
                onChange={(e) => setEdit((x) => ({ ...x, [key(p)]: Number(e.target.value.replace(/\D/g, "")) || 0 }))} />
            ) },
            { key: "risk", label: t("At risk from"), align: "end", render: (p) => `${p.at_risk_pct}%` },
            { key: "bh", label: t("Hours"), render: (p) => (p.business_hours ? t("Business hours") : t("Around the clock")) },
          ]} />
        <Field label={t("My digest")}>
          <Select value={cur} onChange={(e) => setDg(e.target.value as Digest)} options={[{ value: "daily", label: t("Daily") }, { value: "weekly", label: t("Weekly") }, { value: "off", label: t("Off") }]} />
        </Field>
      </Card>

      <Card title={t("Teams")}>
        <DataTable label={t("Triage teams")} rows={teams.data ?? []} rowKey={(r) => r.id} height={220}
          columns={[
            { key: "name", label: t("Team"), render: (r) => r.name },
            { key: "strategy", label: t("Sharing"), render: (r) => (r.strategy === "round_robin" ? t("In turn") : t("Least loaded")) },
            { key: "lead", label: t("Lead"), render: (r) => name(r.lead_user_id) },
            { key: "members", label: t("Members"), align: "end", render: (r) => String(r.member_ids.length) },
            { key: "open", label: t("Open items"), align: "end", render: (r) => String(r.open_items) },
            { key: "act", label: t("Remove"), render: (r) => <Button variant="ghost" onClick={() => act(() => deleteTeam(r.id), t("Team removed."))}>{t("Remove")}</Button> },
          ]} />
        <Row>
          <Field label={t("New team")}><Input value={team} onChange={(e) => setTeam(e.target.value)} /></Field>
          <Button variant="secondary" disabled={!team.trim()} onClick={() => act(async () => { await createTeam({ name: team.trim(), strategy: "round_robin", member_ids: [] }); setTeam(""); }, t("Team added."))}>{t("Add team")}</Button>
        </Row>
      </Card>

      <Card title={t("Assignment rules")} sub={t("The first rule that matches an item decides who gets it.")}>
        {(rules.data ?? []).length === 0 ? <EmptyState heading={t("No assignment rules yet.")} body={t("Add a rule to assign new findings to a person automatically.")} /> : (
          <DataTable label={t("Assignment rules")} rows={rules.data ?? []} rowKey={(r) => r.id} height={300}
            columns={[
              { key: "pos", label: t("Order"), align: "end", render: (r) => String(r.position), sort: (r) => r.position },
              { key: "name", label: t("Rule"), render: (r) => r.name },
              { key: "match", label: t("Matches"), render: (r) => Object.entries(r.match).filter(([, v]) => v?.length).map(([k, v]) => <Code key={k} code={k} description={(v as string[]).join(", ")} />) },
              { key: "to", label: t("Assigns to"), render: (r) => name(r.assign_user_id) || teams.data?.find((x) => x.id === r.assign_team_id)?.name || "" },
              { key: "on", label: t("On"), render: (r) => <Toggle label={t("Rule {name} is on", { name: r.name })} checked={r.enabled} onChange={(v) => act(() => setAssignRuleEnabled(r, v), t("Rule updated."))} /> },
              { key: "del", label: t("Remove"), render: (r) => <Button variant="ghost" onClick={() => act(() => deleteAssignRule(r.id), t("Rule removed."))}>{t("Remove")}</Button> },
            ]} />
        )}
      </Card>
    </Sec>
  );
}
