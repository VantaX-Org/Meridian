"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLinks, getLinkTypes, LINK_LIMIT, type LinkType, type RecordLink } from "@/lib/api/v2/links";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { typeText } from "@/design/v2/screens/Links";
import { Button, Chip, Code, DataTable, EmptyState, PartBar, StatCard, type Column } from "../../kit";
import { ChartCard, compact } from "../ChartCard";
import { QueryView } from "../states";
import { httpStatus, noRetry4xx } from "./util";

/**
 * Record links, native: which records of different objects point at each other, as relationship discovery read them
 * from SAP's link tables or inferred them. Search one record to see every link of it in both directions. Read only.
 */
export function RecordLinks() {
  const fixture = useFixture();
  const [draft, setDraft] = useState({ domain: "", key: "" });
  const [query, setQuery] = useState({ domain: "", key: "" });
  const [ended, setEnded] = useState(false);
  const links = useQuery({
    queryKey: ["record-links", fixture, query.domain, query.key, ended],
    queryFn: () => getLinks({ domain: query.domain, key: query.key, include_inactive: ended }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: noRetry4xx,
  });
  const types = useQuery({ queryKey: ["record-link-types", fixture], queryFn: getLinkTypes, staleTime: 300_000, retry: noRetry4xx });
  const [seen, setSeen] = useState<string[]>([]);
  const rows = links.data?.relationships ?? [];
  const objects = [...new Set([...seen, ...rows.flatMap((l) => [l.from_domain, l.to_domain])])].sort();
  if (objects.length !== seen.length) setSeen(objects);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ domain: draft.domain, key: draft.domain ? draft.key.trim() : "" });
  };

  if (httpStatus(links.error) === 403) return <EmptyState heading={t("Your role cannot read the record links.")} />;
  const total = links.data?.total ?? 0;
  const partial = total > rows.length;
  const inferred = rows.filter((l) => l.ai_inferred).length;
  const byType = new Map<string, number>();
  for (const l of rows) byType.set(l.relationship_type, (byType.get(l.relationship_type) ?? 0) + 1);
  const filtered = query.domain !== "";

  const cols: Column<RecordLink>[] = [
    { id: "from", label: t("From"), compare: (a, b) => a.from_key.localeCompare(b.from_key), cell: (l) => <Code code={l.from_key} text={moduleText(l.from_domain)} /> },
    {
      id: "link", label: t("Link"), cell: (l) => (
        <span className="nx-cell-stack">
          <Code code={l.relationship_type} text={typeText(l.relationship_type) ?? undefined} />
          {l.active ? null : <Chip tone="neutral">{t("Ended")}</Chip>}
        </span>
      ),
    },
    { id: "to", label: t("To"), compare: (a, b) => a.to_key.localeCompare(b.to_key), cell: (l) => <Code code={l.to_key} text={moduleText(l.to_domain)} /> },
    {
      id: "found", label: t("Found in"), cell: (l) =>
        l.ai_inferred ? (
          <span className="nx-cell-stack">{t("Inferred")}{l.ai_confidence == null ? null : <span className="nx-sub">{t("{p} confidence", { p: pct1(l.ai_confidence) })}</span>}</span>
        ) : l.sap_link_table ? <span className="nx-mono">{l.sap_link_table}</span> : "-",
    },
    { id: "on", label: t("Found on"), align: "end", compare: (a, b) => a.discovered_at.localeCompare(b.discovered_at), cell: (l) => formatDate(l.discovered_at, "date") },
  ];
  const typeCols: Column<LinkType>[] = [
    { id: "link", label: t("Link"), cell: (k) => <Code code={k.relationship_type} text={typeText(k.relationship_type) ?? k.description ?? undefined} /> },
    { id: "from", label: t("From table"), cell: (k) => <span className="nx-mono">{k.from_table}</span> },
    { id: "to", label: t("To table"), cell: (k) => <span className="nx-mono">{k.to_table}</span> },
  ];

  return (
    <div className="nx-body" data-testid="links-page">
      <form className="nx-row nx-wrap" onSubmit={submit} aria-label={t("Find the links of one record")} data-testid="links-search">
        <label className="nx-field">
          {t("Object")}
          <select className="nx-input" value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })}>
            <option value="">{t("Any object")}</option>
            {objects.map((o) => <option key={o} value={o}>{moduleText(o)}</option>)}
          </select>
        </label>
        <label className="nx-field">
          {t("Record key")}
          <input className="nx-input" value={draft.key} disabled={!draft.domain} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder={t("Any record")} />
        </label>
        <label className="nx-check">
          <input type="checkbox" checked={ended} onChange={(e) => setEnded(e.target.checked)} />
          {t("Include ended links")}
        </label>
        <Button type="submit" variant="secondary">{t("Show links")}</Button>
      </form>
      <QueryView
        loading={links.isPending} error={links.error} onRetry={() => void links.refetch()} empty={rows.length === 0}
        emptyHeading={filtered ? t("Nothing is linked to this record.") : t("No links have been discovered yet. Discovery runs with each sync of a system.")}
        label={t("Record links")}
      >
        <section aria-label={t("Links between records")} data-testid="links-banner">
          <p className="nx-sub">
            {filtered && query.key ? t("{n} links to {key}", { n: int(total), key: query.key }) : t("{n} records linked across objects", { n: int(total) })}
            {partial ? ` ${t("The lists show the latest {n}; search a record to see all of its links.", { n: int(LINK_LIMIT) })}` : null}
          </p>
          <div className="nx-statgrid">
            <StatCard label={t("Link types")} value={byType.size} />
            <StatCard label={t("Objects linked")} value={new Set(rows.flatMap((l) => [l.from_domain, l.to_domain])).size} />
            <StatCard label={t("Inferred, not read from SAP")} value={rows.length ? (inferred / rows.length) * 100 : 0} format={(n) => pct1(n / 100)} />
          </div>
        </section>
        <div className="nx-chartcards">
          <ChartCard
            title={t("Links by type")} state="ready" testId="links-types"
            chart={<PartBar segments={[...byType].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({ label: `${typeText(type) ?? type} (${type})`, value: n }))} label={t("Links by type")} format={compact} />}
            figure={int(rows.length)} line={partial ? t("Of the latest {n}", { n: int(rows.length) }) : t("All {n}", { n: int(rows.length) })}
            emptyLine={t("Nothing is linked to this record.")}
          />
        </div>
        <div data-testid="links-table">
          <DataTable rows={rows} columns={cols} rowKey={(l) => l.id} rowLabel={(l) => `${l.from_key} ${l.to_key}`} caption={t("Links")} total={total} />
        </div>
      </QueryView>
      <section data-testid="links-known" aria-label={t("Link types SAP defines")}>
        <h3 className="nx-sub">{t("Link types SAP defines")}</h3>
        <DataTable
          rows={types.data ?? []} columns={typeCols} rowKey={(k) => k.id} rowLabel={(k) => k.relationship_type} caption={t("Link types SAP defines")}
          loading={types.isLoading} error={types.isError ? { sentence: t("The link types could not be read."), onRetry: () => void types.refetch() } : undefined}
        />
      </section>
    </div>
  );
}
