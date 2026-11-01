"use client";

import "../approvals.css";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import { useMutation } from "@tanstack/react-query";
import { remindPerson, type Person } from "@/lib/api/v2/people";
import { errorSentence } from "@/lib/api/v2/client";
import { useToast } from "../Toast";
import { useOpenItem, usePhone } from "@/lib/v2/hooks";
import { PEOPLE_SORT_LABEL, objectsLine, roleWord, slaMet, sortPeople, type PeopleSort } from "@/lib/v2/people";
import { usePeople } from "@/lib/v2/approvals-queries";
import { useWorkSummary } from "@/lib/v2/work-queries";
import { int } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { PeopleActions } from "./PeopleActions";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";

const n = (x: number): string => whole(x);
const slaNote = (): string => t("Share of their open work that is not yet past its due date.");

function Head({ label, k, sort, reverse, set, right }: { label: string; k: PeopleSort; sort: PeopleSort; reverse: boolean; set: (k: PeopleSort) => void; right?: boolean }) {
  const on = sort === k;
  return (
    <th scope="col" className={right ? "m2-r" : undefined} aria-sort={on ? (reverse ? "ascending" : "descending") : "none"}>
      <button type="button" className="m2-sortbtn" aria-pressed={on} onClick={() => set(k)}>
        {label}
      </button>
    </th>
  );
}

/** Sends the person a notice about their overdue work (POST /people/{id}/remind); the API sends at most one a day. */
function RemindButton({ id, name }: { id: string; name: string }) {
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => remindPerson(id),
    onSuccess: () => toast.show(t("{name} was reminded of their overdue work.", { name })),
    onError: (e) => toast.show(errorSentence(e, t("The reminder could not be sent.")), "error"),
  });
  return (
    <button type="button" className="m2-btn m2-sm" disabled={m.isPending || m.isSuccess} onClick={() => m.mutate()} aria-label={t("Remind {name}", { name })}>
      {t("Remind")}
    </button>
  );
}

function sentenceOf(people: readonly Person[]): string {
  if (people.length === 0) return "";
  const holders = people.filter((p) => p.open_work > 0).length;
  const open = people.reduce((a, p) => a + p.open_work, 0);
  const late = people.reduce((a, p) => a + p.overdue, 0);
  const me = people.find((p) => p.is_me);
  const mine = me && me.approvals_waiting > 0 ? t(" {n} {approvals_waiting, plural, one {batch waits} other {batches wait}} for your approval.", { n: n(me.approvals_waiting), approvals_waiting: me.approvals_waiting }) : "";
  return t("{n} of {n2} {peopleCount, plural, one {person holds} other {people hold}} open work: {n3} {open, plural, one {record} other {records}}, {n4} overdue.{mine}", { n: n(holders), n2: n(people.length), peopleCount: people.length, n3: n(open), open, n4: n(late), mine });
}

/** The banner and the workload bars: who has overdue work, one action, and each person's open work as a bar. */
function PeopleOverview({ rows, unassigned }: { rows: readonly Person[]; unassigned: number | null }) {
  const late = rows.filter((p) => p.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  const lateTotal = late.reduce((a, p) => a + p.overdue, 0);
  const worst = late[0];
  const open = rows.reduce((a, p) => a + p.open_work, 0);
  const bars = [...rows]
    .filter((p) => p.open_work > 0)
    .sort((a, b) => b.open_work - a.open_work)
    .slice(0, 10)
    .map((p) => ({
      key: p.id,
      label: (
        <>
          {p.name} <span className="m2-meta">{roleWord(p.role)}</span>
        </>
      ),
      value: p.open_work,
      tone: p.overdue > 0 ? ("crit" as const) : ("data" as const),
      text: p.overdue > 0 ? t("{open} open, {late} overdue", { open: int(p.open_work), late: int(p.overdue) }) : t("{open} open", { open: int(p.open_work) }),
    }));
  return (
    <>
      <CcBanner
        testId="people-banner"
        label={t("Overdue work")}
        eyebrow={t("Overdue work")}
        verdict={lateTotal > 0 ? "no-go" : "go"}
        headline={
          worst
            ? t("{n} {late, plural, one {person has} other {people have}} overdue work", { n: int(late.length), late: late.length })
            : t("Nobody has overdue work")
        }
        why={worst ? t("{name} has the most, {n} {overdue, plural, one {record} other {records}} past the due date.", { name: worst.name, n: int(worst.overdue), overdue: worst.overdue }) : t("Everything assigned is still inside its due date.")}
        figs={[
          { label: t("Open records"), value: int(open), note: t("held by {n} people", { n: int(rows.filter((p) => p.open_work > 0).length) }) },
          { label: t("Overdue"), value: int(lateTotal), note: t("past the due date") },
          { label: t("Unassigned"), value: unassigned == null ? "—" : int(unassigned), note: t("nobody holds them") },
        ]}
        action={
          worst ? (
            <V2Link href={`/work?assigned=${encodeURIComponent(worst.id)}&due=overdue`} className="m2-btn m2-next">
              {t("Open {name}'s overdue work", { name: worst.name })}
            </V2Link>
          ) : (
            <V2Link href="/work" className="m2-btn m2-next">
              {t("Open the work list")}
            </V2Link>
          )
        }
      />
      {bars.length > 0 ? (
        <section className="m2-cc-card" aria-label={t("Open work per person")} data-testid="people-workload">
          <h3>{t("Open work per person")}</h3>
          <CcBanner_legend />
          <CcHBars rows={bars} label={t("Open work per person")} />
        </section>
      ) : null}
    </>
  );
}

function CcBanner_legend() {
  return <p className="m2-cc-lede">{t("Red bars belong to people with overdue work.")}</p>;
}

/** People: the owners and stewards of the data with their open work, approvals waiting and SLA. Click a row to open the person. */
export function PeopleCanvas() {
  const q = usePeople();
  const phone = usePhone();
  const { open, hrefFor } = useOpenItem();
  const [sort, setSort] = useState<PeopleSort>("open");
  const [reverse, setReverse] = useState(false);
  const rows = useMemo(() => sortPeople(q.data?.people ?? [], sort, reverse), [q.data, sort, reverse]);
  // The open work nobody holds: the work list's open total less what the people hold, so the page adds up.
  const summary = useWorkSummary().data;
  const assigned = rows.reduce((n, p) => n + (p.open_work ?? 0), 0);
  const unassigned = summary ? Math.max(0, summary.totals.open - assigned) : null;
  const choose = (k: PeopleSort) => {
    if (k === sort) setReverse((r) => !r);
    else {
      setSort(k);
      setReverse(false);
    }
  };
  const openId = open?.kind === "person" ? open.id : null;

  if (q.isError) {
    return (
      <CcPage>
        <PageTitle>{t("People")}</PageTitle>
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The people could not be read. Check that the API is reachable, then retry.")}</ErrorFrame>
      </CcPage>
    );
  }
  if (q.isLoading) {
    return (
      <CcPage>
        <PageTitle>{t("People")}</PageTitle>
        <Skeleton width="100%" height={220} />
      </CcPage>
    );
  }
  if (rows.length === 0) {
    return (
      <CcPage>
        <PageTitle>{t("People")}</PageTitle>
        <EmptyFrame>{t("Nobody owns an object or holds work yet. Set an owner on an object, or assign records, and people appear here with their open work.")}</EmptyFrame>
      </CcPage>
    );
  }

  return (
    <CcPage>
    <div data-testid="people-canvas">
      <PageTitle sub={t("Owners and stewards")}>{t("People")}</PageTitle>
      <PeopleOverview rows={rows} unassigned={unassigned} />
      <p className="m2-finding" data-testid="people-sentence">
        {sentenceOf(rows)}
        {unassigned != null && summary ? <>{" "}{t("{unassigned} of the {total} open records are assigned to nobody.", { unassigned: int(unassigned), total: int(summary.totals.open) })}</> : null}
      </p>
      <p className="m2-prov">
        {t("Counts are read from the work assigned in the latest state. Open counts the records assigned to the person that are not yet signed off; To approve counts the fix batches that wait for their approval; Overdue counts their open records past the due date; Total counts every open record, assigned or not.")}{" "}<V2Link href={hrefFor({ kind: "triage", id: "" })}>{t("Triage and SLA")}</V2Link>
      </p>
      <PeopleActions />
      {phone ? (
        <ul className="m2-plist" aria-label={t("People")}>
          {rows.map((p) => {
            const met = slaMet(p);
            return (
              <li key={p.id}>
                <V2Link href={hrefFor({ kind: "person", id: p.id })} className="m2-prow" data-me={p.is_me ? "true" : undefined} aria-current={openId === p.id ? "true" : undefined}>
                  <span>
                    {p.name}
                    {p.is_me ? <span className="m2-you">{t("you")}</span> : null}
                  </span>
                  <span>{t("{open_work} open", { open_work: int(p.open_work) })}</span>
                  <span className="m2-c">
                    {[roleWord(p.role), t("{approvals_waiting} to approve", { approvals_waiting: int(p.approvals_waiting) }), t("{overdue} overdue", { overdue: int(p.overdue) }), met == null ? null : t("SLA met {met}%", { met })].filter(Boolean).join(", ")}
                  </span>
                </V2Link>
              </li>
            );
          })}
          {unassigned != null ? (
            <li data-testid="people-unassigned">
              <V2Link href="/work?assigned=unassigned" className="m2-prow">
                <span>{t("Unassigned")}</span>
                <span>{t("{open_work} open", { open_work: int(unassigned) })}</span>
              </V2Link>
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="m2-people m2-frame" style={{ overflowX: "auto" }}>
          <table className="m2-tbl" aria-label={t("People")} data-testid="people-table">
            <thead>
              <tr>
                <Head label={PEOPLE_SORT_LABEL.name} k="name" sort={sort} reverse={reverse} set={choose} />
                <th scope="col">{t("Objects")}</th>
                <Head label={PEOPLE_SORT_LABEL.open} k="open" sort={sort} reverse={reverse} set={choose} right />
                <Head label={PEOPLE_SORT_LABEL.approvals} k="approvals" sort={sort} reverse={reverse} set={choose} right />
                <Head label={PEOPLE_SORT_LABEL.overdue} k="overdue" sort={sort} reverse={reverse} set={choose} right />
                <Head label={PEOPLE_SORT_LABEL.sla} k="sla" sort={sort} reverse={reverse} set={choose} right />
                <Head label={PEOPLE_SORT_LABEL.breaches} k="breaches" sort={sort} reverse={reverse} set={choose} right />
                <Head label={PEOPLE_SORT_LABEL.last} k="last" sort={sort} reverse={reverse} set={choose} />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const met = slaMet(p);
                const objs = objectsLine(p);
                return (
                  <tr key={p.id} data-me={p.is_me ? "true" : undefined} data-open={openId === p.id ? "true" : undefined}>
                    <th scope="row">
                      <span className="m2-who">
                        <span>
                          <V2Link href={hrefFor({ kind: "person", id: p.id })} className="m2-rowlink">
                            {p.name}
                          </V2Link>
                          {p.is_me ? <span className="m2-you">{t("you")}</span> : null}
                        </span>
                        <small>{roleWord(p.role)}</small>
                      </span>
                    </th>
                    <td title={p.objects_owned.map((o) => `${o.label} (${o.as})`).join(", ") || undefined}>{objs ?? <Dash why={t("Owns or stewards no object")} />}</td>
                    <td className="m2-r">{int(p.open_work)}</td>
                    <td className="m2-r">{int(p.approvals_waiting)}</td>
                    <td className="m2-r">
                      {p.overdue > 0 ? (
                        <>
                          <V2Link href={`/work?assigned=${encodeURIComponent(p.id)}&due=overdue`} data-testid="person-overdue">{int(p.overdue)}</V2Link>
                          {p.is_me ? null : <> <RemindButton id={p.id} name={p.name} /></>}
                        </>
                      ) : (
                        int(p.overdue)
                      )}
                    </td>
                    <td className="m2-r" title={p.sla_met_pct == null ? slaNote() : undefined}>
                      {met == null ? <Dash why={t("No open work")} /> : `${met}%`}
                    </td>
                    <td className="m2-r">{int(p.breaches_this_month)}</td>
                    <td>{p.last_action_at ? formatDate(p.last_action_at, "date") : <Dash why={t("No action is recorded")} />}</td>
                  </tr>
                );
              })}
              {unassigned != null ? (
                <tr data-testid="people-unassigned">
                  <th scope="row">
                    <V2Link href="/work?assigned=unassigned" className="m2-rowlink">{t("Unassigned")}</V2Link>
                  </th>
                  <td><Dash why={t("Records nobody is assigned to")} /></td>
                  <td className="m2-r">{int(unassigned)}</td>
                  <td colSpan={5} className="m2-meta">{t("Assign them on Work to give each an owner and an SLA.")}</td>
                </tr>
              ) : null}
            </tbody>
            {unassigned != null && summary ? (
              <tfoot>
                <tr data-testid="people-total">
                  <th scope="row">{t("Total")}</th>
                  <td />
                  <td className="m2-r">{int(summary.totals.open)}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </div>
    </CcPage>
  );
}
