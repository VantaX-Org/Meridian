"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { acceptMinedRule, getProfile, type Dependency, type FieldStats, type Severity, type TableProfile } from "@/lib/api/v2/profile";
import { useFixture } from "@/lib/api/v2/fixture";
import { v2Download } from "@/lib/api/v2/download";
import { errorSentence } from "@/lib/api/v2/client";
import { useRunParam, useV2Session } from "@/lib/v2/hooks";
import { useLandscape, useReceipt } from "@/lib/v2/queries";
import { f1, int, moduleFromSlug } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { ResultFrame, useOutcome } from "../../inspector/shared";
import { useToast } from "../../Toast";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../../parts";
import { ScrollFrame } from "./ScrollFrame";
import { TableExport } from "@/design/v2/TableExport";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_WORD: Record<Severity, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

/** What the values of a field look like: the commonest codes, the range of a number or date, or why they are withheld. */
function Values({ s }: { s: FieldStats }) {
  if (s.dates) return <>{s.dates.min && s.dates.max ? t("{min} to {max}", { min: s.dates.min, max: s.dates.max }) : <Dash />}{s.dates.invalid ? ` ${t("({count} not a date)", { count: int(s.dates.invalid) })}` : ""}</>;
  if (s.numeric) return <>{s.numeric.min != null && s.numeric.max != null ? t("{min} to {max}, mean {mean}", { min: f1(s.numeric.min), max: f1(s.numeric.max), mean: f1(s.numeric.mean) }) : <Dash />}</>;
  if (s.top_values?.length) {
    return (
      <span className="m2-meta">
        {s.top_values.slice(0, 3).map((v, i) => (
          <span key={v.value}>
            {i ? ", " : ""}
            <Mono>{v.value}</Mono> {int(v.count)}
          </span>
        ))}
      </span>
    );
  }
  if (s.masked) return <Dash why={s.mask_reason === "privacy" ? t("Withheld: the field holds personal data") : t("Free text or a key: a list of values says nothing")} />;
  return <Dash />;
}

function TableBlock({ tp }: { tp: TableProfile }) {
  return (
    <section className="m2-sec" aria-label={t("Fields of {table}", { table: tp.table })}>
      <div className="m2-sechead">
        <h2 className="m2-h2">
          <Mono>{tp.table}</Mono>
        </h2>
        <span className="m2-sub">
          {tp.sampled
            ? t("{rows} of {total} rows profiled, a sample", { rows: int(tp.rows), total: int(tp.table_rows) })
            : t("{rows} rows profiled", { rows: int(tp.rows) })}
        </span>
      </div>
      <ScrollFrame label={t("Fields of {table}, scrollable", { table: tp.table })}>
        <TableExport><table className="m2-tbl m2-ftbl" aria-label={t("Field profile of {table}", { table: tp.table })}>
          <thead>
            <tr>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Type")}</th>
              <th scope="col" className="m2-r">{t("Blank")}</th>
              <th scope="col" className="m2-r">{t("Distinct")}</th>
              <th scope="col" className="m2-r">{t("Length")}</th>
              <th scope="col">{t("Values")}</th>
            </tr>
          </thead>
          <tbody>
            {tp.fields.map(({ field, stats: s }) => (
              <tr key={field}>
                <th scope="row" className="m2-fcell">
                  <Mono>{field}</Mono>
                  <span className="m2-meta">{s.description ?? <Dash why={t("The data dictionary has no text for this field")} />}</span>
                </th>
                <td>{s.ddic_type ? <Mono>{s.ddic_length ? `${s.ddic_type} ${s.ddic_length}` : s.ddic_type}</Mono> : <Dash />}</td>
                <td className="m2-r">{`${f1(s.blank_pct)}%`}</td>
                <td className="m2-r">{int(s.distinct)}</td>
                <td className="m2-r">{s.min_length == null || s.max_length == null ? <Dash /> : s.min_length === s.max_length ? int(s.min_length) : t("{min} to {max}", { min: int(s.min_length), max: int(s.max_length) })}</td>
                <td>
                  <Values s={s} />
                </td>
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      </ScrollFrame>
    </section>
  );
}

/** A qualified field with its dictionary text beside it: MARA-MTART Material type. */
function FieldName({ q, texts }: { q: string; texts: Map<string, string> }) {
  const text = texts.get(q);
  return (
    <>
      <Mono>{q}</Mono> {text ? <span className="m2-meta">{text}</span> : null}
    </>
  );
}

function Dependencies({ deps, module, texts, versionId }: { deps: Dependency[]; module: string; texts: Map<string, string>; versionId: string }) {
  const qc = useQueryClient();
  const f = useFixture();
  const canAccept = useV2Session().can("manage_rules");
  const { outcome, pending, run } = useOutcome();
  const [picked, setPicked] = useState<Record<string, Severity>>({});
  const key = (d: Dependency) => `${d.determinant}>${d.dependent}`;
  return (
    <section className="m2-sec" aria-label={t("Mined dependencies")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Mined dependencies")}</h2>
        <span className="m2-sub">{t("Where one field's value decides another's in almost every record. Each one can become a rule.")}</span>
      </div>
      {deps.length === 0 ? (
        <EmptyFrame>{t("No dependency between the fields of this object held in enough records to propose a rule.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Mined dependencies, scrollable")}>
          <TableExport><table className="m2-tbl" aria-label={t("Mined dependencies")}>
            <thead>
              <tr>
                <th scope="col">{t("When this field is set")}</th>
                <th scope="col">{t("It decides")}</th>
                <th scope="col" className="m2-r">{t("Holds in")}</th>
                <th scope="col" className="m2-r">{t("Rows")}</th>
                <th scope="col" className="m2-r">{t("Breaking it")}</th>
                <th scope="col">{t("Example records")}</th>
                <th scope="col">{t("Rule")}</th>
              </tr>
            </thead>
            <tbody>
              {deps.map((d) => (
                <tr key={key(d)} data-testid="dependency">
                  <td><FieldName q={d.determinant} texts={texts} /></td>
                  <td><FieldName q={d.dependent} texts={texts} /></td>
                  <td className="m2-r">{`${f1(d.support * 100)}%`}</td>
                  <td className="m2-r">{int(d.rows)}</td>
                  <td className="m2-r">{int(d.violations)}</td>
                  <td>{d.sample_keys.length ? <Mono>{d.sample_keys.slice(0, 2).join(", ")}</Mono> : <Dash />}</td>
                  <td>
                    {d.accepted ? (
                      t("Checked every run")
                    ) : canAccept ? (
                      <span className="m2-adm-acts">
                        <select className="m2-inp m2-sm" aria-label={t("Severity for {field}", { field: d.dependent })} value={picked[key(d)] ?? "medium"} onChange={(e) => setPicked({ ...picked, [key(d)]: e.target.value as Severity })}>
                          {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_WORD[s]()}</option>)}
                        </select>
                        <button
                          type="button"
                          className="m2-btn m2-sm"
                          disabled={pending !== null}
                          onClick={() =>
                            void run(key(d), async () => {
                              const r = await acceptMinedRule({ module, determinant: d.determinant, dependent: d.dependent, severity: picked[key(d)] ?? "medium" });
                              await qc.invalidateQueries({ queryKey: ["v2", "profile", f, versionId] });
                              return { tone: "ok", title: t("Rule {id} added. It runs from the next analysis.", { id: r.name.split(":")[0] }) };
                            })
                          }
                        >
                          {pending === key(d) ? t("Adding…") : t("Make it a rule")}
                        </button>
                      </span>
                    ) : (
                      <Dash why={t("Needs the right to manage rules")} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></TableExport>
        </ScrollFrame>
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </section>
  );
}

/** Saves the field profile of the object as an Excel file (GET /systems/{id}/versions/{v}/profile/export). */
function ProfileExport({ systemId, versionId, module }: { systemId: string | undefined; versionId: string; module: string }) {
  const session = useV2Session();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <p className="m2-prov">
      <button
        type="button"
        className="m2-btn"
        disabled={busy || !systemId || !session.can("export")}
        onClick={async () => {
          if (session.fixture) return toast.show(t("Fixture mode: no file is produced"));
          setBusy(true);
          try {
            await v2Download(`/systems/${encodeURIComponent(systemId ?? "")}/versions/${encodeURIComponent(versionId)}/profile/export`, { object: module, format: "xlsx" }, "profile.xlsx");
            toast.show(t("Profile downloading"));
          } catch (err) {
            toast.show(errorSentence(err, t("The export failed.")), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Export the field profile")}
      </button>
    </p>
  );
}

/** The Profile tab: what the run found in each field the object reads, and the dependencies mined between them. */
export function ProfileTab({ module: moduleSegment }: { system: string; module: string }) {
  const run = useRunParam();
  const f = useFixture();
  const apiModule = moduleFromSlug(moduleSegment);
  const L = useLandscape(run);
  const label = L.data?.objects.find((o) => o.module === apiModule)?.label ?? apiModule.replace(/_/g, " ");
  const receiptQ = useReceipt(apiModule, run);
  const versionId = receiptQ.data?.run_id ?? "";
  const q = useQuery({ queryKey: ["v2", "profile", f, versionId, apiModule], queryFn: () => getProfile(versionId, apiModule), enabled: Boolean(versionId), retry: false });

  if (receiptQ.isError || q.isError) {
    return <ErrorFrame onRetry={() => { void receiptQ.refetch(); void q.refetch(); }}>{t("The field profile of {label} could not be read.", { label })}</ErrorFrame>;
  }
  if (receiptQ.isPending || q.isPending) {
    return (
      <div aria-busy="true" data-testid="profile-loading">
        <Skeleton width="100%" height={220} />
      </div>
    );
  }
  const p = q.data;
  if (p.tables.length === 0) {
    return <EmptyFrame>{t("This run did not profile {label}. A profile is taken when an analysis reads the object from SAP.", { label })}</EmptyFrame>;
  }
  const texts = new Map(p.tables.flatMap((tp) => tp.fields.filter((x) => x.stats.description).map((x) => [`${tp.table}.${x.field}`, x.stats.description as string] as const)));
  const fields = p.tables.reduce((n, tp) => n + tp.fields.length, 0);
  const open = p.dependencies.filter((d) => !d.accepted).length;
  return (
    <div className="m2-procs">
      <p className="m2-finding" data-testid="profile-sentence">
        {t("{fields} fields across {tables} tables profiled. {open} mined {open, plural, one {dependency is} other {dependencies are}} not yet a rule.", { fields, tables: p.tables.length, open })}
      </p>
      {p.tables.map((tp) => (
        <TableBlock key={tp.table} tp={tp} />
      ))}
      <ProfileExport systemId={L.data?.cells.find((c) => c.module === apiModule && c.run_id === versionId)?.system_id} versionId={versionId} module={apiModule} />
      <Dependencies deps={p.dependencies} module={apiModule} texts={texts} versionId={versionId} />
      <p className="m2-prov">{t("Counts are of the rows read in this run. Values are withheld for personal data and for free text, where a list of values says nothing.")}</p>
    </div>
  );
}
