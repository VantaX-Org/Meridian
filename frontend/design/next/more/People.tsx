"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { usePeople } from "@/lib/v2/approvals-queries";
import { useWorkSummary } from "@/lib/v2/work-queries";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { PEOPLE_SORT_LABEL, objectsLine, roleWord, slaMet, sortPeople } from "@/lib/v2/people";
import { remindPerson, type Person } from "@/lib/api/v2/people";
import { exportGrid } from "@/lib/api/v2/roles";
import { errorSentence } from "@/lib/api/v2/client";
import { downloadCsv, tableCsv } from "@/lib/v2/grid-export";
import { failureText } from "@/lib/v2/errors";
import { NxLink } from "@/design/next/kit";
import { Button, Chip, DataTable, useToast, type Column } from "../kit";
import { ListSearch, QueryView } from "./states";
import { PeopleCard } from "./cards";
import { whole } from "@/lib/v2/format";

/** One sentence on who holds open work, as the v2 people screen said it. */
function sentenceOf(people: readonly Person[]): string {
  if (people.length === 0) return "";
  const holders = people.filter((p) => p.open_work > 0).length;
  const open = people.reduce((a, p) => a + p.open_work, 0);
  const late = people.reduce((a, p) => a + p.overdue, 0);
  const me = people.find((p) => p.is_me);
  const mine = me && me.approvals_waiting > 0 ? t(" {n} {approvals_waiting, plural, one {batch waits} other {batches wait}} for your approval.", { n: whole(me.approvals_waiting), approvals_waiting: me.approvals_waiting }) : "";
  return t("{n} of {n2} {peopleCount, plural, one {person holds} other {people hold}} open work: {n3} {open, plural, one {record} other {records}}, {n4} overdue.{mine}", { n: whole(holders), n2: whole(people.length), peopleCount: people.length, n3: whole(open), open, n4: whole(late), mine });
}


const num = (a: number | null, b: number | null): number => (a ?? -1) - (b ?? -1);
const lastAt = (p: Person): number | null => (p.last_action_at ? Date.parse(p.last_action_at) : null);
const overdueHref = (id: string): string => `/work?assigned=${encodeURIComponent(id)}&due=overdue`;

/** Sends the person a notice about their overdue work (POST /people/{id}/remind); the API sends at most one a day. */
export function RemindButton({ id, name }: { id: string; name: string }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => remindPerson(id),
    onSuccess: () => toast({ text: t("{name} was reminded of their overdue work.", { name }), tone: "good" }),
    onError: (e) => toast({ text: errorSentence(e, t("The reminder could not be sent.")), tone: "bad" }),
  });
  return (
    <Button size={32} variant="quiet" loading={m.isPending} disabled={m.isSuccess} reason={m.isSuccess ? t("Sent") : undefined} onClick={() => m.mutate()} aria-label={t("Remind {name}", { name })}>
      {t("Remind")}
    </Button>
  );
}

/** The people table's columns and rows as plain text, for Excel and CSV. */
export function peopleExport(rows: readonly Person[]): { columns: { key: string; header: string; kind?: "text" | "int" | "pct" }[]; rows: Record<string, string | number | null>[] } {
  return {
    columns: [
      { key: "name", header: PEOPLE_SORT_LABEL.name },
      { key: "role", header: t("Role") },
      { key: "email", header: t("Email") },
      { key: "objects", header: t("Objects") },
      { key: "open", header: PEOPLE_SORT_LABEL.open, kind: "int" },
      { key: "approvals", header: PEOPLE_SORT_LABEL.approvals, kind: "int" },
      { key: "overdue", header: PEOPLE_SORT_LABEL.overdue, kind: "int" },
      { key: "sla", header: PEOPLE_SORT_LABEL.sla, kind: "pct" },
      { key: "breaches", header: PEOPLE_SORT_LABEL.breaches, kind: "int" },
      { key: "last", header: PEOPLE_SORT_LABEL.last },
    ],
    rows: rows.map((p) => ({
      name: p.name,
      role: roleWord(p.role),
      email: p.email ?? "",
      objects: objectsLine(p) ?? "",
      open: p.open_work,
      approvals: p.approvals_waiting,
      overdue: p.overdue,
      sla: slaMet(p),
      breaches: p.breaches_this_month,
      last: p.last_action_at ? formatDate(p.last_action_at, "date") : "",
    })),
  };
}

/**
 * Who holds the open work. The person with the most overdue work is the one action; the table sorts, opens a person in
 * the side panel, links each overdue count to that work, reminds, and exports. Balance work, Data contracts and Out
 * of office open their panels, as on the old People page.
 */
export function People() {
  const q = usePeople();
  const session = useV2Session();
  const { hrefFor, openItem } = useOpenItem();
  const toast = useToast();
  const summary = useWorkSummary().data;
  const [find, setFind] = useState("");
  const people = useMemo(() => sortPeople(q.data?.people ?? [], "open"), [q.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? people.filter((p) => `${p.name} ${p.email ?? ""}`.toLowerCase().includes(n)) : people;
  }, [people, find]);
  const assigned = people.reduce((a, p) => a + p.open_work, 0);
  const unassigned = summary ? Math.max(0, summary.totals.open - assigned) : null;
  const worst = [...people].filter((p) => p.overdue > 0).sort((a, b) => b.overdue - a.overdue)[0];
  const live = !session.shared && !session.viewAs;
  const canAssign = session.can("assign");

  const save = async (format: "xlsx" | "csv") => {
    try {
      const data = peopleExport(shown);
      const name = format === "csv" ? downloadCsv("people", tableCsv(data.columns, data.rows)) : await exportGrid({ title: t("People"), route: "people", columns: data.columns, rows: data.rows, total: data.rows.length });
      toast({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(data.rows.length), name }), tone: "good" });
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };

  const columns: Column<Person>[] = [
    {
      id: "name", label: PEOPLE_SORT_LABEL.name, compare: (a, b) => a.name.localeCompare(b.name),
      cell: (p) => (
        <span className="nx-cell-stack">
          <NxLink href={hrefFor({ kind: "person", id: p.id })}>{p.name}</NxLink>
          {p.is_me ? <Chip tone="accent">{t("you")}</Chip> : null}
          <span className="nx-sub">{roleWord(p.role)}</span>
        </span>
      ),
    },
    { id: "objects", label: t("Objects"), cell: (p) => objectsLine(p) ?? t("None") },
    { id: "open", label: PEOPLE_SORT_LABEL.open, align: "end", compare: (a, b) => a.open_work - b.open_work, cell: (p) => int(p.open_work) },
    { id: "approvals", label: PEOPLE_SORT_LABEL.approvals, align: "end", compare: (a, b) => a.approvals_waiting - b.approvals_waiting, cell: (p) => int(p.approvals_waiting) },
    {
      id: "overdue", label: PEOPLE_SORT_LABEL.overdue, align: "end", compare: (a, b) => a.overdue - b.overdue,
      cell: (p) => p.overdue > 0 ? (
        <span className="nx-cell-stack">
          <NxLink href={overdueHref(p.id)} data-testid="person-overdue">{int(p.overdue)}</NxLink>
          {canAssign && !p.is_me ? <RemindButton id={p.id} name={p.name} /> : null}
        </span>
      ) : int(p.overdue),
    },
    { id: "sla", label: PEOPLE_SORT_LABEL.sla, align: "end", compare: (a, b) => num(slaMet(a), slaMet(b)), cell: (p) => { const m = slaMet(p); return m == null ? t("No open work") : `${m}%`; } },
    { id: "breaches", label: PEOPLE_SORT_LABEL.breaches, align: "end", compare: (a, b) => a.breaches_this_month - b.breaches_this_month, cell: (p) => int(p.breaches_this_month) },
    { id: "last", label: PEOPLE_SORT_LABEL.last, compare: (a, b) => num(lastAt(a), lastAt(b)), cell: (p) => (p.last_action_at ? formatDate(p.last_action_at, "date") : t("No action is recorded")) },
  ];

  return (
    <div className="nx-body" data-testid="people-page">
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={people.length === 0} emptyHeading={t("No people yet")} emptyText={t("Nobody owns an object or holds work yet. Set an owner on an object, or assign records, and people appear here with their open work.")} label={t("Loading people")}>
        <div className="nx-chartcards"><PeopleCard /></div>
        <p className="nx-sub" data-testid="people-sentence">{sentenceOf(people)}</p>
        <div className="nx-row nx-wrap" data-testid="people-actions">
          {worst ? (
            <NxLink href={overdueHref(worst.id)} className="nx-btn nx-btn-primary" data-testid="people-next">
              {t("Open {name}'s overdue work", { name: worst.name })}
            </NxLink>
          ) : null}
          {canAssign && live ? <NxLink href={hrefFor({ kind: "balance", id: "" })} className="nx-btn nx-btn-secondary nx-btn-sm">{t("Balance work")}</NxLink> : null}
          <NxLink href={hrefFor({ kind: "contracts", id: "" })} className="nx-btn nx-btn-secondary nx-btn-sm">{t("Data contracts")}</NxLink>
          {live ? <NxLink href={hrefFor({ kind: "away", id: "" })} className="nx-btn nx-btn-secondary nx-btn-sm">{t("Out of office")}</NxLink> : null}
          <NxLink href={hrefFor({ kind: "triage", id: "" })} className="nx-btn nx-btn-quiet nx-btn-sm">{t("Triage and SLA")}</NxLink>
          {session.can("export") ? (
            <>
              <Button size={32} variant="quiet" icon="download" onClick={() => void save("xlsx")}>{t("Export to Excel")}</Button>
              <Button size={32} variant="quiet" icon="download" onClick={() => void save("csv")}>{t("Export to CSV")}</Button>
            </>
          ) : null}
        </div>
        {worst ? <p className="nx-sub">{t("{name} has the most, {n} {overdue, plural, one {record} other {records}} past the due date.", { name: worst.name, n: int(worst.overdue), overdue: worst.overdue })}</p> : null}
        <ListSearch value={find} onChange={setFind} label={t("Search people")} />
        <DataTable
          rows={shown}
          columns={columns}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.name}
          caption={t("People")}
          total={people.length}
          onOpenRow={(p) => openItem({ kind: "person", id: p.id })}
          empty={{ heading: t("No person matches this search.") }}
        />
        {unassigned != null && summary ? (
          <p className="nx-sub" data-testid="people-unassigned">
            <NxLink href="/work?assigned=unassigned">{t("{unassigned} of the {total} open records are assigned to nobody.", { unassigned: int(unassigned), total: int(summary.totals.open) })}</NxLink>{" "}
            {t("Assign them on Work to give each an owner and an SLA.")}
          </p>
        ) : null}
        {canAssign ? <p className="nx-sub">{t("Remind sends the person a note about their overdue work. It does not reassign anything.")}</p> : null}
      </QueryView>
    </div>
  );
}
