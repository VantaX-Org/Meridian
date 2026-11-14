"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { StackedBar, type StackPart } from "@/design/v2/charts";
import { usePeople } from "@/lib/v2/approvals-queries";
import { Chip } from "../kit";
import { ListSearch, LongText, QueryView, VirtualList } from "./states";

const COLOURS = ["--m2-chart-1", "--m2-chart-2", "--m2-chart-3", "--m2-chart-4", "--m2-chart-5", "--m2-chart-6"];

/** Who holds the open work: a stacked bar of the largest holders, then everyone in a searchable list. */
export function People() {
  const q = usePeople();
  const [find, setFind] = useState("");
  const people = useMemo(() => q.data?.people ?? [], [q.data]);
  const parts: StackPart[] = useMemo(() => {
    const top = [...people].filter((p) => p.open_work > 0).sort((a, b) => b.open_work - a.open_work).slice(0, COLOURS.length);
    return top.map((p, i) => ({ key: p.id, label: p.name, value: p.open_work, colour: COLOURS[i], title: t("{name}: {n} open", { name: p.name, n: p.open_work }) }));
  }, [people]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(n)) : people;
  }, [people, find]);
  return (
    <div className="nx-body">
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={people.length === 0} emptyHeading={t("No people yet")} emptyText={t("People appear here once they hold an object or an approval.")} label={t("Loading people")}>
        {parts.length ? <StackedBar parts={parts} label={t("Open work by person")} format={(v) => String(v)} testId="people-bar" /> : <p className="nx-sub">{t("Nobody holds open work.")}</p>}
        <ListSearch value={find} onChange={setFind} label={t("Search people")} />
        {shown.length === 0 ? <p className="nx-sub">{t("No person matches this search.")}</p> : (
          <VirtualList rows={shown} rowKey={(p) => p.id} label={t("People")} render={(p) => (
            <div className="nx-row">
              <LongText text={p.name} className="nx-row-main" />
              <LongText text={p.email ?? ""} className="nx-sub" />
              <Chip>{t("{n} open", { n: p.open_work })}</Chip>
              {p.overdue > 0 ? <Chip tone="bad">{t("{n} overdue", { n: p.overdue })}</Chip> : null}
            </div>
          )} />
        )}
      </QueryView>
    </div>
  );
}
