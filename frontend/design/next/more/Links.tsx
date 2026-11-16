"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLinks, getLinkTypes, LINK_LIMIT, type RecordLink } from "@/lib/api/v2/links";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { Button, Code, DataTable, EmptyState, ErrorState, Skeleton } from "../kit";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";
import { Dash } from "./entry-parts";

/**
 * Record links: which records are linked across objects, as relationship discovery read them from SAP's link tables
 * or inferred them. Search one record to see everything linked to it in both directions. The route answers the latest
 * 200 links with the full count, so the per-type bars say when they cover only part of the total.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

/** What each link type the discovery writes means (api/services/relationship_discovery.py). */
const TYPE_TEXT: Record<string, () => string> = {
  bp_is_customer: () => t("Business partner is a customer"),
  bp_is_vendor: () => t("Business partner is a vendor"),
  material_at_plant: () => t("Material exists at a plant"),
  gl_in_company_code: () => t("G/L account in a company code"),
  vendor_in_company_code: () => t("Vendor in a company code"),
  customer_in_company_code: () => t("Customer in a company code"),
  asset_in_cost_center: () => t("Asset in a cost centre"),
  pay_for_employee: () => t("Basic pay of an employee"),
  po_references_material: () => t("Purchase order item names a material"),
  equipment_in_plant: () => t("Equipment in a plant"),
  customer_in_sales_org: () => t("Customer in a sales area"),
  so_references_material: () => t("Sales order item names a material"),
  bom_references_material: () => t("Bill of material item names a material"),
  stock_in_bin: () => t("Stock in a storage bin"),
  batch_for_material: () => t("Batch of a material"),
  fleet_uses_equipment: () => t("Fleet object is a piece of equipment"),
  shipment_contains_delivery: () => t("Shipment contains a delivery"),
  interface_routes_to_warehouse: () => t("Interface routes to a warehouse"),
  mdg_change_for_entity: () => t("MDG change request for a record"),
  fi_posting_references_bp: () => t("FI posting names a business partner"),
};

const typeText = (type: string) => TYPE_TEXT[type]?.() ?? undefined;

function FoundIn({ l }: { l: RecordLink }) {
  if (l.ai_inferred) {
    return (
      <span>
        {t("Inferred")}
        <span className="nx-sub"> {l.ai_confidence == null ? null : t("{p} confidence", { p: pct1(l.ai_confidence) })}</span>
      </span>
    );
  }
  return l.sap_link_table ? <Code code={l.sap_link_table} /> : <Dash />;
}

export function Links() {
  const fixture = useFixture();
  const [draft, setDraft] = useState({ domain: "", key: "" });
  const [query, setQuery] = useState({ domain: "", key: "" });
  const [ended, setEnded] = useState(false);
  const links = useQuery({
    queryKey: ["record-links", fixture, query.domain, query.key, ended],
    queryFn: () => getLinks({ domain: query.domain, key: query.key, include_inactive: ended }),
    staleTime: 60_000,
    // Keep the last answer on screen while a search loads, so the form stays put.
    placeholderData: keepPreviousData,
    retry,
  });
  const types = useQuery({ queryKey: ["record-link-types", fixture], queryFn: getLinkTypes, staleTime: 300_000, retry });
  // The objects to pick from: those in the unfiltered answer, kept once seen so a filter never empties the list.
  const [seen, setSeen] = useState<string[]>([]);
  const rows = links.data?.relationships ?? [];
  const objects = [...new Set([...seen, ...rows.flatMap((l) => [l.from_domain, l.to_domain])])].sort();
  if (objects.length !== seen.length) setSeen(objects);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery({ domain: draft.domain, key: draft.domain ? draft.key.trim() : "" });
  };

  const title = t("Record links");
  if (links.isPending) return <Skeleton lines={8} label={title} />;
  if (links.isError) {
    return status(links.error) === 403
      ? <EmptyState heading={t("Your role cannot read the record links.")} />
      : <ErrorState sentence={t("The record links could not be read.")} onRetry={() => void links.refetch()} />;
  }
  const total = links.data.total;
  const partial = total > rows.length;
  const inferred = rows.filter((l) => l.ai_inferred).length;
  const byType = new Map<string, number>();
  for (const l of rows) byType.set(l.relationship_type, (byType.get(l.relationship_type) ?? 0) + 1);
  const max = Math.max(1, ...byType.values());
  const filtered = query.domain !== "";

  return (
    <div className="nx-body">
      <Banner
        testId="links-banner"
        label={title}
        meta={t("Links between records")}
        title={filtered && query.key ? t("{n} links to {key}", { n: int(total), key: query.key }) : t("{n} records linked across objects", { n: int(total) })}
        why={partial ? t("The lists show the latest {n}; search a record to see all of its links.", { n: int(LINK_LIMIT) }) : null}
        figs={[
          { label: t("Link types"), value: int(byType.size) },
          { label: t("Objects linked"), value: int(new Set(rows.flatMap((l) => [l.from_domain, l.to_domain])).size) },
          { label: t("Inferred, not read from SAP"), value: rows.length ? pct1(inferred / rows.length) : "—", note: t("{n} links", { n: int(inferred) }) },
        ]}
      />
      <form className="nx-form nx-row" onSubmit={submit} aria-label={t("Find the links of one record")} data-testid="links-search">
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
        <Button type="submit" size={32}>{t("Show links")}</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState heading={filtered ? t("Nothing is linked to this record.") : t("No links have been discovered yet. Discovery runs with each sync of a system.")} />
      ) : (
        <>
          <Fold title={t("Links by type")} hint={t("How many links of each kind the latest rows hold.")}>
            <Panel title={t("Links by type")} meta={partial ? t("Of the latest {n}", { n: int(rows.length) }) : t("All {n}", { n: int(rows.length) })} testId="links-types">
              <HBars
                label={t("Links by type")}
                rows={[...byType].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({
                  key: type,
                  label: <Code code={type} text={typeText(type)} />,
                  value: (n / max) * 100,
                  text: int(n),
                  tone: "good",
                }))}
              />
            </Panel>
          </Fold>
          <Panel title={t("Links")} meta={t("Newest first")} testId="links-table">
            <DataTable
              caption={t("Links")}
              rows={rows}
              rowKey={(l) => l.id}
              rowLabel={(l) => `${l.from_key} ${l.to_key}`}
              columns={[
                { id: "from", label: t("From"), cell: (l) => <span data-testid={`link-${l.id}`}>{moduleText(l.from_domain)} <Code code={l.from_key} /></span> },
                {
                  id: "link",
                  label: t("Link"),
                  cell: (l) => (
                    <span>
                      <Code code={l.relationship_type} text={typeText(l.relationship_type)} />
                      {l.active ? null : <span className="nx-sub"> {t("Ended")}</span>}
                    </span>
                  ),
                },
                { id: "to", label: t("To"), cell: (l) => <span>{moduleText(l.to_domain)} <Code code={l.to_key} /></span> },
                { id: "in", label: t("Found in"), cell: (l) => <FoundIn l={l} /> },
                { id: "on", label: t("Found on"), align: "end", cell: (l) => formatDate(l.discovered_at, "date") },
              ]}
            />
          </Panel>
        </>
      )}
      <Fold title={t("Link types SAP defines")} hint={t("The relationships SAP knows, shared by every system.")}>
        <Panel title={t("Link types SAP defines")} meta={t("Shared by every system")} testId="links-known">
          {types.isError ? (
            <Dash why={t("The link types could not be read.")} />
          ) : !types.data ? (
            <Skeleton lines={3} label={t("Link types SAP defines")} />
          ) : (
            <DataTable
              caption={t("Link types SAP defines")}
              rows={types.data}
              rowKey={(k) => k.id}
              rowLabel={(k) => k.relationship_type}
              columns={[
                { id: "link", label: t("Link"), cell: (k) => <Code code={k.relationship_type} text={typeText(k.relationship_type) ?? k.description ?? undefined} /> },
                { id: "from", label: t("From table"), cell: (k) => <Code code={k.from_table} /> },
                { id: "to", label: t("To table"), cell: (k) => <Code code={k.to_table} /> },
              ]}
            />
          )}
        </Panel>
      </Fold>
      <About
        shows={t("Shows how records of different objects point at each other, and which links SAP defines and which were inferred.")}
        next={{ href: "/objects", label: t("Open the objects") }}
        why={t("This screen only reads. Nothing is linked or unlinked here.")}
        means={[
          [t("Link types"), t("Kinds of relationship between two objects.")],
          [t("Objects linked"), t("Objects that take part in at least one link.")],
          [t("Inferred, not read from SAP"), t("Links Meridian worked out from the data rather than read from an SAP table.")],
        ]}
      />
    </div>
  );
}
