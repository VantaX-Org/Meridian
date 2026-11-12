"use client";

import { useSearchParams } from "next/navigation";
import { splitFieldId, type CatalogueField, type CatalogueTable } from "@/lib/api/v2/catalogue";
import { catalogueStatus, nodeTypeText, sourceText, typeText, useCatalogueTable } from "@/lib/v2/catalogue";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { f1, int, moduleSlug, pct1 } from "@/lib/v2/score";
import { Fact, InspectorFrame } from "../Inspector";
import { FactList, Sec } from "./mdm-parts";
import { SeverityMark, type SeverityKey } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";

const VALUES_SHOWN = 12;
const sev = (s: string): SeverityKey => (s === "critical" || s === "high" || s === "medium" || s === "low" ? s : "info");

/**
 * `?open=field:TABLE.FIELD`: one SAP field from the data catalogue. Its dictionary facts, the rules that read it, its
 * business terms, its newest profile, the owners of the objects that read its table and where its values go. It reads
 * the same table answer as the catalogue canvas (GET /catalogue/tables/{table}), for the system the page names.
 */
export function FieldInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const ref = splitFieldId(id);
  const system = useSearchParams().get("system") ?? "";
  const q = useCatalogueTable(ref?.table ?? "", system, Boolean(ref));
  const f = q.data?.fields.find((x) => x.field === ref?.field);

  return (
    <InspectorFrame title={f?.description || id} status={t("SAP field")} onClose={onClose}>
      {!ref ? (
        <EmptyFrame>{t("This address does not name a field.")}</EmptyFrame>
      ) : q.isPending ? (
        <div aria-busy="true">
          <Skeleton width="100%" height={140} />
        </div>
      ) : q.isError ? (
        catalogueStatus(q.error) === 404 ? (
          <EmptyFrame>{t("This table is not in the catalogue.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("This field could not be read.")}</ErrorFrame>
        )
      ) : !f ? (
        <EmptyFrame>{t("The table has no field of this name.")}</EmptyFrame>
      ) : (
        <FieldBody table={q.data} f={f} />
      )}
    </InspectorFrame>
  );
}

function FieldBody({ table, f }: { table: CatalogueTable; f: CatalogueField }) {
  const { hrefFor } = useOpenItem();
  const owners = table.owners.filter((o) => o.owner_name || o.steward_name);
  const p = f.profile;
  return (
    <>
      <Sec title={t("Facts")}>
        <FactList>
          <Fact label={t("SAP field")}>
            <Mono>{`${table.table}.${f.field}`}</Mono>
          </Fact>
          <Fact label={t("Table")}>{table.description || <Mono>{table.table}</Mono>}</Fact>
          <Fact label={t("Type")}>{f.type ? <Mono>{typeText(f)}</Mono> : <Dash why={t("The dictionary gives no type")} />}</Fact>
          <Fact label={t("Key")}>{f.key ? t("Yes") : t("No")}</Fact>
          {f.mandatory != null ? <Fact label={t("Mandatory")}>{f.mandatory ? t("Yes") : t("No")}</Fact> : null}
          {f.data_element ? <Fact label={t("Data element")}><Mono>{f.data_element}</Mono></Fact> : null}
          {f.domain ? <Fact label={t("Domain")}><Mono>{f.domain}</Mono></Fact> : null}
          {f.check_table ? (
            <Fact label={t("Check table")}>
              <Mono>{f.check_field ? `${f.check_table}.${f.check_field}` : f.check_table}</Mono>
            </Fact>
          ) : null}
          {f.source ? <Fact label={t("Read from")}><Mono>{f.source}</Mono></Fact> : null}
          <Fact label={t("Defined by")}>{sourceText(f.provenance)}</Fact>
        </FactList>
        {f.help ? <p className="m2-rp m2-meta">{f.help}</p> : null}
      </Sec>
      {f.fixed_values.length ? (
        <Sec title={t("Allowed values: {n}", { n: int(f.fixed_values.length) })}>
          <ul className="m2-lk" aria-label={t("Allowed values")}>
            {f.fixed_values.slice(0, VALUES_SHOWN).map((v) => (
              <li key={`${v.low}-${v.high ?? ""}`}>
                <span>
                  <Mono>{v.high ? `${v.low}-${v.high}` : v.low || " "}</Mono> {v.text}
                </span>
              </li>
            ))}
          </ul>
          {f.fixed_values.length > VALUES_SHOWN ? <p className="m2-rp m2-meta">{t("And {n} more.", { n: int(f.fixed_values.length - VALUES_SHOWN) })}</p> : null}
        </Sec>
      ) : null}
      <Sec title={t("Latest profile")}>
        {p ? (
          <>
            <FactList>
              <Fact label={t("Records")}>{int(p.stats.rows)}</Fact>
              <Fact label={t("Blank")}>{t("{n}, {pct}", { n: int(p.stats.blank), pct: pct1(p.stats.blank_pct / 100) })}</Fact>
              <Fact label={t("Distinct values")}>{int(p.stats.distinct)}</Fact>
              {p.stats.min_length != null && p.stats.max_length != null ? (
                <Fact label={t("Length")}>{p.stats.min_length === p.stats.max_length ? int(p.stats.min_length) : t("{min} to {max}", { min: int(p.stats.min_length), max: int(p.stats.max_length) })}</Fact>
              ) : null}
              <Fact label={t("Object")}>{moduleText(p.module)}</Fact>
              <Fact label={t("Run")}>{p.run_at ? formatDate(p.run_at, "date") : <Dash />}</Fact>
            </FactList>
            <p className="m2-rp">
              <V2Link href={`/o/_/${moduleSlug(p.module)}/profile?run=${encodeURIComponent(p.version_id)}`}>{t("Open the profile of this run")}</V2Link>
            </p>
          </>
        ) : (
          <p className="m2-rp m2-meta">{t("No analysed run has profiled this field yet.")}</p>
        )}
      </Sec>
      <Sec title={t("Rules that check it: {n}", { n: int(f.rules.length) })}>
        {f.rules.length === 0 ? (
          <p className="m2-rp m2-meta">{t("No rule reads this field.")}</p>
        ) : (
          <ul className="m2-lk" aria-label={t("Rules that check it")}>
            {f.rules.map((r) => (
              <li key={`${r.check_id}/${r.module}`}>
                <span>
                  <V2Link href={hrefFor({ kind: "rule", id: r.check_id })} className="m2-mono">
                    {r.check_id}
                  </V2Link>{" "}
                  {r.message}
                </span>
                <span className="m2-meta">
                  <SeverityMark severity={sev(r.severity)} /> {labelText(r.severity)}, {moduleText(r.module)}
                  {r.enabled ? null : <>, {t("off")}</>}
                  {r.last_pass_rate != null ? <>, {t("{p}% pass", { p: f1(r.last_pass_rate) })}</> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Sec>
      <Sec title={t("Business terms")}>
        {f.terms.length === 0 ? (
          <p className="m2-rp m2-meta">{t("No business term names this field.")}</p>
        ) : (
          <ul className="m2-lk" aria-label={t("Business terms")}>
            {f.terms.map((x) => (
              <li key={x.id}>
                <V2Link href={hrefFor({ kind: "term", id: x.id })}>{x.business_name}</V2Link>
                <span className="m2-meta">{x.steward_name ? t("Steward {name}", { name: x.steward_name }) : t("No steward")}</span>
              </li>
            ))}
          </ul>
        )}
      </Sec>
      <Sec title={t("Used by")}>
        <FactList>
          <Fact label={t("Objects")}>{table.objects.length ? table.objects.map(moduleText).join(", ") : <Dash why={t("No object's rules read this table")} />}</Fact>
          <Fact label={t("Systems")}>{table.systems.length ? table.systems.map((s) => s.name).join(", ") : <Dash why={t("No connected system uses this table yet")} />}</Fact>
          {owners.map((o) => (
            <Fact key={`${o.kind}:${o.ref}`} label={o.kind === "object" ? moduleText(o.ref) : table.systems.find((s) => s.id === o.ref)?.name ?? t("System")}>
              {[o.owner_name ? t("Owner {name}", { name: o.owner_name }) : null, o.steward_name ? t("Steward {name}", { name: o.steward_name }) : null].filter(Boolean).join(", ")}
            </Fact>
          ))}
        </FactList>
      </Sec>
      <Sec title={t("Where its values go")}>
        {f.downstream.length === 0 ? (
          <p className="m2-rp m2-meta">{t("The lineage model draws nothing below this field.")}</p>
        ) : (
          <>
            <ul className="m2-lk" aria-label={t("Where its values go")}>
              {f.downstream.map((n) => (
                <li key={n.id}>
                  <span>{n.label}</span>
                  <span className="m2-meta">{t("{type}, {hops, plural, one {# step} other {# steps}} away", { type: nodeTypeText(n.type), hops: n.hops })}</span>
                </li>
              ))}
            </ul>
            {table.objects[0] ? (
              <p className="m2-rp">
                <V2Link href={`/o/_/${moduleSlug(table.objects[0])}/lineage`}>{t("Open the lineage of {object}", { object: moduleText(table.objects[0]) })}</V2Link>
              </p>
            ) : null}
          </>
        )}
      </Sec>
    </>
  );
}
