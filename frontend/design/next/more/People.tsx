"use client";

import { useMemo, useState } from "react";
import { t } from "@/lib/v2/i18n";
import { usePeople } from "@/lib/v2/approvals-queries";
import { Chip } from "../kit";
import { ListSearch, LongText, QueryView, VirtualList } from "./states";
import { PeopleCard } from "./cards";

/** Who holds the open work: a chart card of the largest holders, then everyone in a searchable list. */
export function People() {
  const q = usePeople();
  const [find, setFind] = useState("");
  const people = useMemo(() => q.data?.people ?? [], [q.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(n)) : people;
  }, [people, find]);
  return (
    <div className="nx-body">
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={people.length === 0} emptyHeading={t("No people yet")} emptyText={t("People appear here once they hold an object or an approval.")} label={t("Loading people")}>
        <div className="nx-chartcards"><PeopleCard /></div>
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
