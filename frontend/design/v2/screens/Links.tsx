"use client";

import { useState, type FormEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getLinks, getLinkTypes, LINK_LIMIT, type RecordLink } from "@/lib/api/v2/links";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int, pct1 } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { Disclose, Guide } from "./Guide";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";
import { TableExport } from "@/design/v2/TableExport";

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

const typeText = (type: string) => TYPE_TEXT[type]?.() ?? null;

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

  if (links.isPending) return <CcPage title={t("Record links")}><Skeleton width="100%" height={320} /></CcPage>;
  if (links.isError) {
    return (
      <CcPage title={t("Record links")}>
        {status(links.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the record links.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void links.refetch()}>{t("The record links could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const total = links.data.total;
  const partial = total > rows.length;
  const inferred = rows.filter((l) => l.ai_inferred).length;
  const byType = new Map<string, number>();
  for (const l of rows) byType.set(l.relationship_type, (byType.get(l.relationship_type) ?? 0) + 1);
  const filtered = query.domain !== "";

  return (
    <CcPage title={t("Record links")}>
      <Guide
        shows={t("Shows how records of different objects point at each other, and which links SAP defines and which were inferred.")}
        next={{ href: "/objects", label: t("Open the objects") }}
        why={t("This screen only reads. Nothing is linked or unlinked here.")}
        means={[
          [t("Link types"), t("Kinds of relationship between two objects.")],
          [t("Objects linked"), t("Objects that take part in at least one link.")],
          [t("Inferred, not read from SAP"), t("Links Meridian worked out from the data rather than read from an SAP table.")],
        ]}
      />
      <CcBanner
        eyebrow={t("Links between records")}
        headline={
          filtered && query.key
            ? t("{n} links to {key}", { n: int(total), key: query.key })
            : t("{n} records linked across objects", { n: int(total) })
        }
        why={partial ? t("The lists show the latest {n}; search a record to see all of its links.", { n: int(LINK_LIMIT) }) : undefined}
        figs={[
          { label: t("Link types"), value: int(byType.size) },
          { label: t("Objects linked"), value: int(new Set(rows.flatMap((l) => [l.from_domain, l.to_domain])).size) },
          { label: t("Inferred, not read from SAP"), value: rows.length ? pct1(inferred / rows.length) : "—", note: t("{n} links", { n: int(inferred) }) },
        ]}
        testId="links-banner"
        label={t("Record links")}
      />
      <form className="m2-rfilters" onSubmit={submit} aria-label={t("Find the links of one record")} data-testid="links-search">
        <label>
          {t("Object")}
          <select className="m2-sel" value={draft.domain} onChange={(e) => setDraft({ ...draft, domain: e.target.value })}>
            <option value="">{t("Any object")}</option>
            {objects.map((o) => (
              <option key={o} value={o}>{moduleText(o)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Record key")}
          <input className="m2-inp" value={draft.key} disabled={!draft.domain} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder={t("Any record")} />
        </label>
        <label>
          <input type="checkbox" checked={ended} onChange={(e) => setEnded(e.target.checked)} />
          {t("Include ended links")}
        </label>
        <button type="submit" className="m2-btn">{t("Show links")}</button>
      </form>
      {rows.length === 0 ? (
        <EmptyFrame>
          {filtered ? t("Nothing is linked to this record.") : t("No links have been discovered yet. Discovery runs with each sync of a system.")}
        </EmptyFrame>
      ) : (
        <>
          <Disclose title={t("Links by type")} hint={t("How many links of each kind the latest rows hold.")}>
          <Panel title={t("Links by type")} meta={partial ? t("Of the latest {n}", { n: int(rows.length) }) : t("All {n}", { n: int(rows.length) })} testId="links-types">
            <CcHBars
              label={t("Links by type")}
              rows={[...byType].sort((a, b) => b[1] - a[1]).map(([type, n]) => ({
                key: type,
                label: <>{typeText(type)} <Mono>{type}</Mono></>,
                value: n,
                text: int(n),
              }))}
            />
          </Panel>
          </Disclose>
          <Panel title={t("Links")} meta={t("Newest first")} testId="links-table">
            <ScrollFrame label={t("Links")}>
              <TableExport><table className="m2-tbl m2-cards">
                <caption className="m2-sr">{t("Links")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("From")}</th>
                    <th scope="col">{t("Link")}</th>
                    <th scope="col">{t("To")}</th>
                    <th scope="col">{t("Found in")}</th>
                    <th scope="col">{t("Found on")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => <LinkRow key={l.id} l={l} />)}
                </tbody>
              </table></TableExport>
            </ScrollFrame>
          </Panel>
        </>
      )}
      <Disclose title={t("Link types SAP defines")} hint={t("The relationships SAP knows, shared by every system.")}>
      <Panel title={t("Link types SAP defines")} meta={t("Shared by every system")} testId="links-known">
        {types.isError ? (
          <Dash why={t("The link types could not be read.")} />
        ) : !types.data ? (
          <Skeleton width="100%" height={80} />
        ) : (
          <ScrollFrame label={t("Link types SAP defines")}>
            <TableExport><table className="m2-tbl m2-cards">
              <caption className="m2-sr">{t("Link types SAP defines")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("Link")}</th>
                  <th scope="col">{t("From table")}</th>
                  <th scope="col">{t("To table")}</th>
                </tr>
              </thead>
              <tbody>
                {types.data.map((k) => (
                  <tr key={k.id}>
                    <th scope="row" className="m2-card-lead">
                      {typeText(k.relationship_type) ?? k.description ?? k.relationship_type} <Mono>{k.relationship_type}</Mono>
                    </th>
                    <td data-label={t("From table")}><Mono>{k.from_table}</Mono></td>
                    <td data-label={t("To table")}><Mono>{k.to_table}</Mono></td>
                  </tr>
                ))}
              </tbody>
            </table></TableExport>
          </ScrollFrame>
        )}
      </Panel>
      </Disclose>
    </CcPage>
  );
}

function LinkRow({ l }: { l: RecordLink }) {
  return (
    <tr data-ended={l.active ? undefined : "true"}>
      <th scope="row" className="m2-card-lead">
        {moduleText(l.from_domain)} <Mono>{l.from_key}</Mono>
      </th>
      <td data-label={t("Link")}>
        {typeText(l.relationship_type) ?? <Mono>{l.relationship_type}</Mono>}
        {l.active ? null : <span className="m2-meta"> {t("Ended")}</span>}
      </td>
      <td data-label={t("To")}>
        {moduleText(l.to_domain)} <Mono>{l.to_key}</Mono>
      </td>
      <td data-label={t("Found in")}>
        {l.ai_inferred ? (
          <>
            {t("Inferred")}
            <span className="m2-meta"> {l.ai_confidence == null ? null : t("{p} confidence", { p: pct1(l.ai_confidence) })}</span>
          </>
        ) : l.sap_link_table ? (
          <Mono>{l.sap_link_table}</Mono>
        ) : (
          <Dash />
        )}
      </td>
      <td data-label={t("Found on")} className="m2-num">{formatDate(l.discovered_at, "date")}</td>
    </tr>
  );
}
