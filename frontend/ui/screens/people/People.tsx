"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { remindPerson, type Person } from "@/lib/api/v2/people";
import { createShareLink, listShareLinks, revokeShareLink } from "@/lib/api/v2/roles";
import { useNextSteps, usePeople } from "@/lib/v2/approvals-queries";
import { relTime } from "@/lib/v2/format";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { objectsLine, roleWord, slaMet, slaWord, sortPeople } from "@/lib/v2/people";
import { Button, Card, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, Select, Skeleton, StatTile, useAletheia, useAletheiaScope, useSheet, useToast, PageHeader } from "@/ui/kit";
import { Gate, day, refreshV2, useQ } from "./common";

const SECTIONS = [
  { href: "/people/stewardship", label: () => t("Stewardship") },
  { href: "/people/contracts", label: () => t("Contracts") },
  { href: "/people/digests", label: () => t("Digests") },
  { href: "/people/assignments", label: () => t("Assignments") },
];

function ShareCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState("7");
  const links = useQ(["share-links"], () => listShareLinks());
  const make = useMutation({
    mutationFn: () => createShareLink("/people", {}, Number(days), label.trim() || undefined),
    onSuccess: (l) => { setLabel(""); toast(t("Link made: {url}", { url: l.url }), "good"); void refreshV2(qc); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeShareLink(id), onSuccess: () => void refreshV2(qc) });
  const stateWord = (s: string) => (s === "active" ? t("Active") : s === "expired" ? t("Expired") : t("Revoked"));
  return (
    <Card title={t("Share links")} sub={t("A read-only link to this page for someone without an account.")}>
      <Field label={t("Label")}><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label={t("Expires after")}>
        <Select value={days} onChange={(e) => setDays(e.target.value)} options={[{ value: "1", label: t("1 day") }, { value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }]} />
      </Field>
      <Button variant="primary" disabled={make.isPending} onClick={() => make.mutate()}>{t("Make a link")}</Button>
      <Gate q={links} label={t("Loading links")}>
        {(d) => d.links.length === 0 ? <EmptyState heading={t("No share links")} body={t("Make one above to share this page.")} /> : (
          <ul className="mx-list" aria-label={t("Share links")}>
            {d.links.map((l) => (
              <li key={l.id}>
                <span>{l.label ?? l.route}</span>{" "}
                <span className="mx-muted">{stateWord(l.state_word)}, {t("{n} opens", { n: l.open_count })}, {t("expires {d}", { d: day(l.expires_at) })}</span>{" "}
                {l.state_word === "active" ? <Button variant="ghost" onClick={() => revoke.mutate(l.id)}>{t("Revoke")}</Button> : null}
              </li>
            ))}
          </ul>
        )}
      </Gate>
    </Card>
  );
}

export function People() {
  useInterfaceLang();
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const sheet = useSheet();
  const chat = useAletheia();
  const people = usePeople();
  const next = useNextSteps();
  const remind = useMutation({
    mutationFn: (id: string) => remindPerson(id),
    onSuccess: () => { toast(t("Reminder sent"), "good"); void refreshV2(qc); },
  });
  const list = people.data?.people ?? [];
  const late = list.reduce((n, p) => n + p.overdue, 0);
  const waiting = list.reduce((n, p) => n + p.approvals_waiting, 0);

  useAletheiaScope({
    key: "people",
    label: t("Asking about people"),
    suggestions: [t("Who is behind?"), t("Who has approvals waiting?")],
    answer: (prompt) => {
      const behind = sortPeople(list, "overdue").filter((p) => p.overdue > 0).slice(0, 3);
      if (prompt === t("Who has approvals waiting?")) {
        const w = sortPeople(list, "approvals").filter((p) => p.approvals_waiting > 0).slice(0, 3);
        return { text: w.length ? t("{n} approvals wait, most with {name}.", { n: waiting, name: w[0].name }) : t("No approvals wait."), evidence: w.map((p) => `${p.name}: ${p.approvals_waiting}`) };
      }
      return { text: behind.length ? t("{n} items are overdue, most with {name}.", { n: late, name: behind[0].name }) : t("Nobody is behind."), evidence: behind.map((p) => `${p.name}: ${p.overdue}`) };
    },
  });

  if (people.isPending) return <Skeleton lines={8} label={t("Loading people")} />;
  if (people.isError) return <ErrorState heading={t("People could not be loaded")} />;

  const rows = sortPeople(list, "open");
  const open = (id: string, arg?: unknown) => sheet.open(id, arg);
  return (
    <>
      <PageHeader
        title={t("People")}
        context={t("{n} people, {late} items overdue, {w} approvals waiting", { n: list.length, late, w: waiting })}
        actions={<>
          <Button variant="primary" onClick={() => open("invite")}>{t("Invite a person")}</Button>
          <Button variant="secondary" onClick={() => open("balance")}>{t("Balance the work")}</Button>
          <Button variant="secondary" onClick={() => open("delegations")}>{t("Delegations")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <nav className="mx-links" aria-label={t("People and governance")}>
        {SECTIONS.map((s) => <Button key={s.href} variant="secondary" href={withFixture(s.href, fx)}>{s.label()}</Button>)}
      </nav>
      <dl className="mx-tiles">
        <StatTile label={t("People")} value={list.length} />
        <StatTile label={t("Overdue")} value={late} />
        <StatTile label={t("Approvals waiting")} value={waiting} />
      </dl>
      <Card title={t("Everyone")} sub={t("The first row is you. Select a row for the person.")}>
        {rows.length === 0 ? <EmptyState heading={t("No people yet")} body={t("Invite the first person.")} /> : (
          <DataTable<Person>
            label={t("People")}
            rows={rows}
            rowKey={(p) => p.id}
            onSelect={(p) => open("person", p)}
            columns={[
              { key: "name", label: t("Person"), sort: (p) => p.name, render: (p) => <span>{p.name}{p.is_me ? ` (${t("you")})` : ""} <span className="mx-muted">{roleWord(p.role)}</span></span> },
              { key: "objects", label: t("Objects"), render: (p) => (p.objects_owned.length ? <span>{p.objects_owned.slice(0, 2).map((o) => <FieldChip key={o.module} code={o.module} description={o.label} />)} <span className="mx-muted">{objectsLine(p)}</span></span> : <span className="mx-muted">{t("None")}</span>) },
              { key: "open", label: t("Open"), align: "end", sort: (p) => p.open_work, render: (p) => p.open_work },
              { key: "appr", label: t("Approvals"), align: "end", sort: (p) => p.approvals_waiting, render: (p) => p.approvals_waiting },
              { key: "late", label: t("Overdue"), align: "end", sort: (p) => p.overdue, render: (p) => (p.overdue > 0 && !p.is_me ? <Button variant="ghost" onClick={(e) => { e.stopPropagation(); remind.mutate(p.id); }}>{t("Remind {n}", { n: p.overdue })}</Button> : p.overdue) },
              { key: "sla", label: t("SLA met"), align: "end", sort: (p) => slaMet(p) ?? -1, render: (p) => (slaMet(p) === null ? t("n/a") : `${slaMet(p)}%${p.sla_hours ? `, ${slaWord(p.sla_hours)}` : ""}`) },
              { key: "br", label: t("Breaches"), align: "end", sort: (p) => p.breaches_this_month, render: (p) => p.breaches_this_month },
              { key: "last", label: t("Last action"), sort: (p) => p.last_action_at ?? "", render: (p) => (p.last_action_at ? relTime(p.last_action_at) : t("Never")) },
            ]}
          />
        )}
      </Card>
      <Card title={t("Your next steps")}>
        <Gate q={next} label={t("Loading next steps")}>
          {(d) => d.items.length === 0 ? <EmptyState heading={t("Nothing waits for you")} /> : (
            <ul className="mx-list" aria-label={t("Your next steps")}>
              {d.items.map((s) => <li key={`${s.kind}-${s.id}`}><Button variant="ghost" href={withFixture(s.href, fx)}>{s.title || t("Overdue")}</Button> <span className="mx-muted">{s.count}</span></li>)}
            </ul>
          )}
        </Gate>
      </Card>
      <ShareCard />
    </>
  );
}
