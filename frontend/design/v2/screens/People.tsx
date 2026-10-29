"use client";

import "../approvals.css";
import { useMemo, useState } from "react";
import { formatDate } from "@/lib/format";
import type { Person } from "@/lib/api/v2/people";
import { useOpenItem, usePhone } from "@/lib/v2/hooks";
import { PEOPLE_SORT_LABEL, objectsLine, roleWord, slaMet, sortPeople, type PeopleSort } from "@/lib/v2/people";
import { usePeople } from "@/lib/v2/approvals-queries";
import { int } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";

const n = (x: number): string => x.toLocaleString("en-US");
const SLA_NOTE = "Share of their open work that is not yet past its due date.";

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

function sentenceOf(people: readonly Person[]): string {
  if (people.length === 0) return "";
  const holders = people.filter((p) => p.open_work > 0).length;
  const open = people.reduce((a, p) => a + p.open_work, 0);
  const late = people.reduce((a, p) => a + p.overdue, 0);
  const me = people.find((p) => p.is_me);
  const mine = me && me.approvals_waiting > 0 ? ` ${n(me.approvals_waiting)} ${me.approvals_waiting === 1 ? "batch waits" : "batches wait"} for your approval.` : "";
  return `${n(holders)} of ${n(people.length)} ${people.length === 1 ? "person holds" : "people hold"} open work: ${n(open)} ${open === 1 ? "record" : "records"}, ${n(late)} overdue.${mine}`;
}

/** People: the owners and stewards of the data with their open work, approvals waiting and SLA. Click a row to open the person. */
export function PeopleCanvas() {
  const q = usePeople();
  const phone = usePhone();
  const { open, hrefFor } = useOpenItem();
  const [sort, setSort] = useState<PeopleSort>("open");
  const [reverse, setReverse] = useState(false);
  const rows = useMemo(() => sortPeople(q.data?.people ?? [], sort, reverse), [q.data, sort, reverse]);
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
      <>
        <PageTitle>People</PageTitle>
        <ErrorFrame onRetry={() => void q.refetch()}>The people could not be read. Check that the API is reachable, then retry.</ErrorFrame>
      </>
    );
  }
  if (q.isLoading) {
    return (
      <>
        <PageTitle>People</PageTitle>
        <Skeleton width="100%" height={220} />
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        <PageTitle>People</PageTitle>
        <EmptyFrame>Nobody owns an object or holds work yet. Set an owner on an object, or assign records, and people appear here with their open work.</EmptyFrame>
      </>
    );
  }

  return (
    <div data-testid="people-canvas">
      <PageTitle sub="Owners and stewards">People</PageTitle>
      <p className="m2-finding" data-testid="people-sentence">
        {sentenceOf(rows)}
      </p>
      <p className="m2-prov">
        Counts are read from the work assigned in the latest state. <V2Link href={hrefFor({ kind: "triage", id: "" })}>Triage and SLA</V2Link>
      </p>
      {phone ? (
        <ul className="m2-plist" aria-label="People">
          {rows.map((p) => {
            const met = slaMet(p);
            return (
              <li key={p.id}>
                <V2Link href={hrefFor({ kind: "person", id: p.id })} className="m2-prow" data-me={p.is_me ? "true" : undefined} aria-current={openId === p.id ? "true" : undefined}>
                  <span>
                    {p.name}
                    {p.is_me ? <span className="m2-you">you</span> : null}
                  </span>
                  <span>{`${int(p.open_work)} open`}</span>
                  <span className="m2-c">
                    {[roleWord(p.role), `${int(p.approvals_waiting)} to approve`, `${int(p.overdue)} overdue`, met == null ? null : `SLA met ${met}%`].filter(Boolean).join(", ")}
                  </span>
                </V2Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="m2-people m2-frame" style={{ overflowX: "auto" }}>
          <table className="m2-tbl" aria-label="People" data-testid="people-table">
            <thead>
              <tr>
                <Head label={PEOPLE_SORT_LABEL.name} k="name" sort={sort} reverse={reverse} set={choose} />
                <th scope="col">Objects</th>
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
                          {p.is_me ? <span className="m2-you">you</span> : null}
                        </span>
                        <small>{roleWord(p.role)}</small>
                      </span>
                    </th>
                    <td title={p.objects_owned.map((o) => `${o.label} (${o.as})`).join(", ") || undefined}>{objs ?? <Dash why="Owns or stewards no object" />}</td>
                    <td className="m2-r">{int(p.open_work)}</td>
                    <td className="m2-r">{int(p.approvals_waiting)}</td>
                    <td className="m2-r">{int(p.overdue)}</td>
                    <td className="m2-r" title={p.sla_met_pct == null ? SLA_NOTE : undefined}>
                      {met == null ? <Dash why="No open work" /> : `${met}%`}
                    </td>
                    <td className="m2-r">{int(p.breaches_this_month)}</td>
                    <td>{p.last_action_at ? formatDate(p.last_action_at, "date") : <Dash why="No action is recorded" />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
