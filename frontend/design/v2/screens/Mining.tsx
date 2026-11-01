"use client";

import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { getAnomalies, getDuplicates, getMiningOverview, getPatterns, getRelationships, LIMITS, runMining, type AnomalyItem, type DuplicatePair, type MiningPattern } from "@/lib/api/v2/mining";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int, pct1 } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Data mining: the likely duplicate records, the values far outside their field's usual range and the fields whose
 * values move together, as the mining tasks found them on the latest run of every object. Each list is read on its
 * own, so one that fails or is forbidden leaves the others on the page. The patterns group the same rows: outliers
 * by object and field, duplicates by object.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;

function useMining<T>(name: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["mining", fixture, name], queryFn: fn, staleTime: 60_000, retry: (n, e) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; } });
}

const METHOD: Record<string, () => string> = {
  iqr: () => t("Outside the usual range"),
  zscore: () => t("Far from the average"),
};

const LINK: Record<string, () => string> = {
  correlation: () => t("Move together"),
  functional_dependency: () => t("One decides the other"),
};

/** Duplicate pairs and outliers per object, most findings first. */
export function byObject(dupes: readonly DuplicatePair[], outliers: readonly AnomalyItem[]): { module: string; dupes: number; outliers: number }[] {
  const by = new Map<string, { module: string; dupes: number; outliers: number }>();
  const at = (m: string) => by.get(m) ?? by.set(m, { module: m, dupes: 0, outliers: 0 }).get(m)!;
  for (const d of dupes) at(d.module_id).dupes += 1;
  for (const a of outliers) at(a.module_id).outliers += 1;
  return [...by.values()].sort((a, b) => b.dupes + b.outliers - (a.dupes + a.outliers));
}

/** The modules to mine per analysis run, from the landscape cells that have a run. */
export function runsToMine(cells: readonly { run_id?: string | null; module: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of cells) if (c.run_id) out.set(c.run_id, [...new Set([...(out.get(c.run_id) ?? []), c.module])]);
  return out;
}

export function Mining() {
  const overview = useMining("summary", getMiningOverview);
  const dupes = useMining("duplicates", getDuplicates);
  const outliers = useMining("anomalies", getAnomalies);
  const links = useMining("relationships", getRelationships);
  const patterns = useMining("patterns", getPatterns);

  if (overview.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (overview.isError) {
    return (
      <CcPage>
        {status(overview.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the mining results.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void overview.refetch()}>{t("The mining figures could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const o = overview.data;
  const nd = dupes.data?.length;
  const no = outliers.data?.length;
  const more = (n: number | undefined, limit: number) => (n == null ? "—" : n >= limit ? t("{n} or more", { n: int(n) }) : int(n));

  return (
    <CcPage>
      <CcBanner
        testId="mining"
        label={t("Data mining")}
        eyebrow={t("Data mining")}
        headline={t("{d} likely duplicate pairs and {o} outliers in the current data", { d: more(nd, LIMITS.duplicates), o: more(no, LIMITS.anomalies) })}
        why={t("Found by comparing records and values, not by the rules. Review them before they become rules or merges.")}
        figs={[
          { label: t("Patterns, last {n} days", { n: int(o.window_days) }), value: int(o.total_patterns), note: t("outliers grouped by field, duplicates by object") },
          { label: t("Objects mined"), value: `${f1(o.coverage_pct)}%`, note: t("of the analysed objects") },
          { label: t("Runs mined"), value: int(o.runs_total), note: t("analysis runs with mining results") },
        ]}
        action={<MineAction />}
      />

      <div className="m2-cc-split">
        <Panel title={t("Findings by object")} meta={t("Duplicate pairs and outliers per object.")} testId="mining-objects">
          {dupes.isPending || outliers.isPending ? <Skeleton width="100%" height={120} /> : dupes.isError || outliers.isError ? (
            <Dash why={t("The findings could not be read.")} />
          ) : (() => {
            const rows = byObject(dupes.data, outliers.data);
            return rows.length === 0 ? <EmptyFrame>{t("Mining found no duplicate or outlier.")}</EmptyFrame> : (
              <CcHBars
                label={t("Findings by object")}
                rows={rows.map((r) => ({
                  key: r.module,
                  label: <span>{moduleText(r.module)} <Mono>{r.module}</Mono></span>,
                  value: r.dupes + r.outliers,
                  text: t("{d, plural, one {# duplicate pair} other {# duplicate pairs}}, {o, plural, one {# outlier} other {# outliers}}", { d: r.dupes, o: r.outliers }),
                  tone: "warn",
                }))}
              />
            );
          })()}
        </Panel>
        <Patterns query={patterns} />
      </div>

      <Panel title={t("Likely duplicates")} meta={nd != null ? t("{n} pairs, highest match first", { n: more(nd, LIMITS.duplicates) }) : undefined} testId="mining-duplicates">
        <List query={dupes} empty={t("No likely duplicate was found.")} what={t("The duplicates could not be read.")}>
          {(rows) => (
            <ScrollFrame label={t("Likely duplicates table, scrollable")}>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Record")}</th>
                    <th scope="col">{t("Looks like")}</th>
                    <th scope="col">{t("Match")}</th>
                    <th scope="col">{t("Same values in")}</th>
                    <th scope="col">{t("Found")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td data-label={t("Object")}>{moduleText(d.module_id)}</td>
                      <th scope="row" className="m2-card-lead"><Mono>{d.record_a}</Mono></th>
                      <td data-label={t("Looks like")}><Mono>{d.record_b}</Mono></td>
                      <td data-label={t("Match")}>{pct1(d.match_score)}</td>
                      <td data-label={t("Same values in")}>{d.matched_fields?.length ? <Fields codes={d.matched_fields} texts={d.field_texts} /> : <Dash />}</td>
                      <td data-label={t("Found")}>{formatDate(d.detected_at, "date")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          )}
        </List>
      </Panel>

      <Panel title={t("Outliers")} meta={no != null ? t("{n} values far from the rest of their field", { n: more(no, LIMITS.anomalies) }) : undefined} testId="mining-outliers">
        <List query={outliers} empty={t("No outlier was found.")} what={t("The outliers could not be read.")}>
          {(rows) => (
            <ScrollFrame label={t("Outliers table, scrollable")}>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Record")}</th>
                    <th scope="col">{t("Value")}</th>
                    <th scope="col">{t("Usual")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("How found")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td data-label={t("Object")}>{moduleText(a.module_id)}</td>
                      <th scope="row" className="m2-card-lead"><FieldName code={a.field_name} text={a.field_description} /></th>
                      <td data-label={t("Record")}>{a.record_key ? <Mono>{a.record_key}</Mono> : <Dash />}</td>
                      <td data-label={t("Value")}>{a.field_value == null ? <Dash /> : int(a.field_value)}</td>
                      <td data-label={t("Usual")}>{usual(a)}</td>
                      <td data-label={t("Severity")}><Sev severity={a.severity} /></td>
                      <td data-label={t("How found")}>{METHOD[a.detection_method]?.() ?? labelText(a.detection_method)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          )}
        </List>
      </Panel>

      <Panel title={t("Fields that depend on each other")} meta={t("Candidates for a cross-field rule, strongest first.")} testId="mining-relationships">
        <List query={links} empty={t("No relationship between fields was found.")} what={t("The relationships could not be read.")}>
          {(rows) => (
            <ScrollFrame label={t("Field relationships table, scrollable")}>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("With field")}</th>
                    <th scope="col">{t("Relationship")}</th>
                    <th scope="col">{t("Strength")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => b.strength_score - a.strength_score).map((r) => (
                    <tr key={r.id}>
                      <td data-label={t("Object")}>{moduleText(r.module_id)}</td>
                      <th scope="row" className="m2-card-lead"><FieldName code={r.field_a} text={r.field_a_description} /></th>
                      <td data-label={t("With field")}><FieldName code={r.field_b} text={r.field_b_description} /></td>
                      <td data-label={t("Relationship")}>{LINK[r.relationship_type]?.() ?? labelText(r.relationship_type)}</td>
                      <td data-label={t("Strength")}>{pct1(r.strength_score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          )}
        </List>
      </Panel>
    </CcPage>
  );
}

/** The range the value fell outside, or how many standard deviations it sits from the average. */
function usual(a: AnomalyItem): ReactNode {
  if (a.lower_bound != null && a.upper_bound != null) return t("{lo} to {hi}", { lo: int(a.lower_bound), hi: int(a.upper_bound) });
  if (a.z_score != null) return t("{z} standard deviations away", { z: f1(Math.abs(a.z_score)) });
  return <Dash />;
}

/** A field by its dictionary text with the SAP name beside it; the bare SAP name when the dictionary does not know it. */
function FieldName({ code, text }: { code: string; text?: string | null }) {
  return text ? <>{text} <span className="m2-meta"><Mono>{code}</Mono></span></> : <Mono>{code}</Mono>;
}

function Fields({ codes, texts }: { codes: string[]; texts?: Record<string, string> }) {
  return (
    <ul className="m2-cl-changes">
      {codes.map((c) => <li key={c}><FieldName code={c} text={texts?.[c]} /></li>)}
    </ul>
  );
}

function Patterns({ query }: { query: ReturnType<typeof useMining<{ patterns: MiningPattern[] }>> }) {
  return (
    <Panel title={t("Patterns")} meta={t("Outliers grouped by field, duplicates by object.")} testId="mining-patterns">
      <List query={query} pick={(d) => d.patterns} empty={t("No pattern was found.")} what={t("The patterns could not be read.")}>
        {(rows) => (
          <ScrollFrame label={t("Patterns table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Pattern")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col">{t("Found")}</th>
                  <th scope="col">{t("Confidence")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const field = p.pattern_type === "anomaly" ? p.id.split(":")[2] : null;
                  return (
                    <tr key={p.id}>
                      <th scope="row" className="m2-card-lead">
                        {field ? <>{t("Outliers in")} {p.field_description ?? <Mono>{field}</Mono>}</> : t("Duplicate records")}
                        <div className="m2-meta">{moduleText(p.module)}{field && p.field_description ? <> <Mono>{field}</Mono></> : null}</div>
                      </th>
                      <td data-label={t("Severity")}><Sev severity={p.severity} /></td>
                      <td data-label={t("Found")}>{t("{n} times", { n: int(p.occurrences) })}</td>
                      <td data-label={t("Confidence")}>{pct1(p.confidence)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </List>
    </Panel>
  );
}

/** One list's loading, refusal, failure and empty states, then its rows. */
function List<D, R = D extends readonly unknown[] ? D[number] : never>({ query, pick, empty, what, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; data?: D };
  pick?: (d: D) => readonly R[];
  empty: string;
  what: string;
  children: (rows: readonly R[]) => ReactNode;
}) {
  if (query.isPending) return <Skeleton width="100%" height={120} />;
  if (status(query.error) === 403) return <Dash why={t("Your role cannot read the mining results.")} />;
  if (query.isError || query.data === undefined) return <Dash why={what} />;
  const rows = pick ? pick(query.data) : (query.data as unknown as readonly R[]);
  return rows.length === 0 ? <EmptyFrame>{empty}</EmptyFrame> : <>{children(rows)}</>;
}

function MineAction() {
  const { can } = useV2Session();
  const land = useLandscape(null);
  const toast = useToast();
  const qc = useQueryClient();
  const runs = runsToMine(land.data?.cells ?? []);
  const mine = useMutation({
    mutationFn: () => Promise.all([...runs].map(([run, modules]) => runMining(run, modules))),
    onSuccess: (r) => {
      toast.show(t("Mining started on {n} runs. The lists refresh when it finishes.", { n: int(r.length) }));
      void qc.invalidateQueries({ queryKey: ["mining"] });
    },
    onError: (e) => toast.show(errorSentence(e, t("Mining could not be started.")), "error"),
  });
  if (!can("mdm.write")) return null;
  return (
    <button type="button" className="m2-btn m2-next" disabled={runs.size === 0 || mine.isPending} onClick={() => mine.mutate()} data-testid="mining-run">
      {t("Mine the latest runs")}
    </button>
  );
}

export function Panel({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section className="m2-ck-panel" aria-label={title} data-testid={testId}>
      <header className="m2-ck-head">
        <h2 className="m2-h2">{title}</h2>
        {meta ? <span className="m2-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}
