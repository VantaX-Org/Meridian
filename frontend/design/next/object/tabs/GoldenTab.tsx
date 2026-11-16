"use client";

import "./tabs-g.css";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { applyMatchCalibration, downloadConsolidationPack, GOLDEN_PAGE, proposeMerges, type CalibrationField, type ConsolidationPack, type GoldenRow, type SurvivorshipRule, type TuningPreview } from "@/lib/api/v2/mdm";
import { errorSentence } from "@/lib/api/v2/client";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { mdmKeys, useAcrossSystems, useConsolidationPack, useGoldenRecords, useMatchCalibration, useMatchPairs, useSurvivorship } from "@/lib/v2/mdm-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { int } from "@/lib/v2/score";
import { lc, t } from "@/lib/v2/i18n";
import { useSubmitGuard } from "@/design/next/more/states";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, ProgressBar, Skeleton, StatCard, useToast, type Column } from "../../kit";
import type { ObjectRun } from "../useObjectRun";
import { Dash, ItemLink } from "./tabs-g-parts";

/* ---------- shared labels (also read by the golden record inspector) ---------- */

export const RULE_LABEL: Record<string, string> = {
  get most_recent() { return t("Most recent"); },
  get most_complete() { return t("Most complete"); },
  get most_frequent() { return t("Most frequent"); },
  get trusted_source() { return t("Trusted source"); },
  get chain() { return t("Source chain"); },
  get manual_override() { return t("Steward choice"); },
};

export const COMPARATOR_LABEL: Record<string, string> = {
  get name_legal() { return t("Legal name, company forms, width and accents ignored"); },
  get address_tokens() { return t("Address words in any order"); },
  get tax_exact() { return t("Tax number, punctuation ignored"); },
  get phone_e164() { return t("Phone number in international form"); },
  get bank_exact() { return t("Bank account, punctuation ignored"); },
  get part_number() { return t("Part number, separators and leading zeros ignored"); },
  get desc_tokens() { return t("Description words, abbreviations expanded, sizes must agree"); },
  get code_exact() { return t("Same code"); },
  get email() { return t("E-mail address, case ignored"); },
  get national_id() { return t("National ID, spaces ignored"); },
  get date_exact() { return t("Date, day and month swapped scores 0.7"); },
  get person_name() { return t("Person name, order and accents ignored"); },
  get exact() { return t("Same value"); },
  get fuzzy() { return t("Similar text"); },
};

const PASS_KIND: Record<string, string> = { key: t("Same identifier"), neighbour: t("Sorted name window"), blocked: t("Name within a group") };

const PACK_ACTION: Record<string, string> = {
  flag_for_deletion: t("Flag for deletion"),
  point_to_survivor: t("Point to the survivor"),
  cross_plant_status_block: t("Block with your cross-plant status"),
  posting_block: t("Block posting"),
  order_block: t("Block orders with your order block reason"),
  central_block: t("Block centrally"),
  map_to_survivor: t("Map to the survivor"),
};

/** The rule most fields of the object use, with the full split on hover. */
export function dominantRule(rules: readonly SurvivorshipRule[]): { text: string; title: string } | null {
  const active = rules.filter((r) => r.active);
  if (active.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of active) counts.set(r.rule_type, (counts.get(r.rule_type) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top] = sorted;
  const others = sorted.length - 1;
  const text = `${RULE_LABEL[top[0]] ?? top[0]}${others > 0 ? t(", {others} more", { others }) : ""}`;
  const title = sorted.map(([k, n]) => t("{RULE_LABEL}: {n} {n, plural, one {field} other {fields}}", { RULE_LABEL: RULE_LABEL[k] ?? k, n })).join(", ");
  return { text, title };
}

/** An SAP key with its zero padding trimmed, for reading. */
export const shortKey = (k: string): string => k.replace(/=0+(?=\d)/, "=");
export const confidencePct = (c: number): string => `${Math.round(c * 100)}%`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function FieldName({ field }: { field: string }) {
  const code = field.replace(".", "-");
  return <Code code={code} text={describeField(code) ?? undefined} />;
}

/* ---------- pairs waiting for a steward ---------- */

type Pair = { id: string; a: string; b: string; total: number };

function Candidates({ o }: { o: ObjectRun }) {
  const toast = useToast();
  const qc = useQueryClient();
  const can = useV2Session().can("approve");
  const { openItem } = useOpenItem();
  const { busy, run } = useSubmitGuard();
  const [limit, setLimit] = useState(5);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [priority, setPriority] = useState(3);
  const [due, setDue] = useState("");
  const q = useMatchPairs(o.module, limit);
  const label = o.label;
  const total = q.data?.total ?? 0;
  const waiting = q.data?.bands.review ?? total;
  const pairs = (q.data?.pairs ?? []) as Pair[];

  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const send = () =>
    run(async () => {
      const due_at = due ? new Date(`${due}T23:59:59`).toISOString() : undefined;
      try {
        const res = await proposeMerges([...chosen].map((id) => ({ match_score_id: id, priority, due_at })));
        const n = res.created.length;
        setChosen(new Set());
        void qc.invalidateQueries({ queryKey: mdmKeys.root });
        toast({ text: t("{n} {n, plural, one {pair is} other {pairs are}} on the stewardship queue as merge decisions.", { n }), tone: "good" });
      } catch (err) {
        toast({ text: errorSentence(err, t("The match candidates could not be read.")), tone: "bad" });
      }
    });

  const columns: Column<Pair>[] = [
    ...(can
      ? [
          {
            id: "pick",
            label: t("Choose"),
            cell: (p: Pair) => (
              <input
                type="checkbox"
                className="nx-check"
                checked={chosen.has(p.id)}
                onChange={() => toggle(p.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={t("Choose the pair {a} and {b}", { a: shortKey(p.a), b: shortKey(p.b) })}
              />
            ),
          },
        ]
      : []),
    { id: "score", label: t("Score"), align: "end", cell: (p) => <span className="nx-num">{p.total.toFixed(2)}</span>, compare: (a, b) => a.total - b.total },
    {
      id: "pair",
      label: t("Record pair"),
      cell: (p) => (
        <span className="nx-mono">
          {shortKey(p.a)} {t("and")} {shortKey(p.b)}
        </span>
      ),
    },
    {
      id: "review",
      label: t("Review"),
      cell: (p) => (
        <span aria-label={t("Review the pair {a} and {b}", { a: shortKey(p.a), b: shortKey(p.b) })}>
          <ItemLink kind="golden" id={`pair:${p.id}`}>
            {t("Review")}
          </ItemLink>
        </span>
      ),
    },
  ];

  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Pairs to review")} data-testid="golden-candidates">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Pairs to review")}</h2>
        {q.data ? <span className="nx-tg-sub">{waiting === 1 ? t("1 pair to review") : t("{waiting} pairs to review", { waiting: int(waiting) })}</span> : null}
      </div>
      {q.isError ? (
        <ErrorState sentence={t("The match candidates could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable
          rows={pairs}
          columns={columns}
          rowKey={(p) => p.id}
          rowLabel={(p) => `${shortKey(p.a)} ${t("and")} ${shortKey(p.b)}`}
          caption={t("Pairs to review")}
          loading={q.isPending}
          empty={{ heading: t("Pairs to review"), text: t("No pair of {label} records is waiting for a steward. Pairs appear when a match run scores two records between the review floor and the auto-merge score.", { label: lc(label) }) }}
          onOpenRow={(p) => openItem({ kind: "golden", id: `pair:${p.id}` })}
          density="compact"
        />
      )}
      {pairs.length > 0 && waiting > pairs.length ? (
        <div className="nx-tg-row">
          <p className="nx-tg-prov">{t("Showing the first {pairsCount} of {waiting}, best score first. ", { pairsCount: pairs.length, waiting: int(waiting) })}</p>
          <Button variant="quiet" size={32} onClick={() => setLimit((l) => l + 20)}>
            {t("Show 20 more")}
          </Button>
        </div>
      ) : null}
      {can && pairs.length > 0 ? (
        <div className="nx-tg-form" role="group" aria-label={t("Send pairs to the stewardship queue")}>
          <select className="nx-input" aria-label={t("Priority")} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>{t("Urgent")}</option>
            <option value={3}>{t("Normal")}</option>
            <option value={5}>{t("Low")}</option>
          </select>
          <input type="date" className="nx-input" aria-label={t("Due date, empty for 48 hours")} value={due} onChange={(e) => setDue(e.target.value)} />
          <Button variant="primary" size={32} disabled={chosen.size === 0} loading={busy} loadingLabel={t("Sending…")} onClick={() => void send()}>
            {chosen.size > 0 ? t("Send {n} to a steward", { n: chosen.size }) : t("Choose pairs to send to a steward")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- duplicates across connected systems ---------- */

type Cluster = { id: string; members: { key: string; system_id: string | null; system_name: string | null; text: string | null }[]; pairs: number; best: number; merged: boolean; pair_ids: string[] };

function AcrossSystems({ o }: { o: ObjectRun }) {
  const q = useAcrossSystems(o.module);
  const { openItem } = useOpenItem();
  const label = o.label;
  const columns: Column<Cluster>[] = [
    { id: "best", label: t("Score"), align: "end", cell: (c) => <span className="nx-num">{c.best.toFixed(2)}</span>, compare: (a, b) => a.best - b.best },
    {
      id: "members",
      label: t("Records"),
      cell: (c) => (
        <span className="nx-tg-stack">
          {c.members.map((m) => (
            <span key={`${m.system_id}-${m.key}`}>
              <span className="nx-mono">{shortKey(m.key)}</span> {m.text ?? <Dash why={t("The record has no description")} />} ({m.system_name ?? m.system_id})
            </span>
          ))}
        </span>
      ),
    },
    { id: "state", label: t("Status"), cell: (c) => (c.merged ? <Chip tone="good">{t("Merged")}</Chip> : null) },
    { id: "review", label: t("Review"), cell: (c) => (c.pair_ids[0] ? <ItemLink kind="golden" id={`pair:${c.pair_ids[0]}`}>{t("Review")}</ItemLink> : null) },
  ];
  return (
    <section className="nx-card nx-tg-sec" id="across-systems" aria-label={t("Across systems")} data-testid="golden-across">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Across systems")}</h2>
        {q.data ? <span className="nx-tg-sub">{t("{n} {n2, plural, one {cluster} other {clusters}} across connected systems", { n: int(q.data.clusters_total), n2: q.data.clusters_total })}</span> : null}
      </div>
      {q.isPending ? (
        <Skeleton lines={3} />
      ) : q.isError ? (
        <ErrorState sentence={t("The duplicates across systems could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.clusters_total === 0 ? (
        <p className="nx-tg-prov">{t("No {label} record has a duplicate in another connected system. The cross-system match compares the latest complete run of each connected system that holds this object.", { label: lc(label) })}</p>
      ) : (
        <>
          <ul className="nx-tg-list" aria-label={t("Pairs per system pair")}>
            {q.data.by_systems.map((s) => (
              <li key={`${s.a}-${s.b}`}>
                <span>{t("{a} and {b}: {pairs} pairs, {open} open, {merged} merged", { a: s.a, b: s.b, pairs: int(s.pairs), open: int(s.open), merged: int(s.merged) })}</span>
                <PartBar
                  label={t("{a} and {b}: {n}", { a: s.a, b: s.b, n: int(s.pairs) })}
                  format={int}
                  segments={[
                    { label: t("Open"), value: s.open },
                    { label: t("Merged"), value: s.merged },
                    { label: t("Other"), value: Math.max(0, s.pairs - s.open - s.merged) },
                  ]}
                />
              </li>
            ))}
          </ul>
          <DataTable
            rows={q.data.clusters as Cluster[]}
            columns={columns}
            rowKey={(c) => c.id}
            rowLabel={(c) => c.members.map((m) => shortKey(m.key)).join(` ${t("and")} `)}
            caption={t("Clusters across systems")}
            onOpenRow={(c) => (c.pair_ids[0] ? openItem({ kind: "golden", id: `pair:${c.pair_ids[0]}` }) : undefined)}
            density="compact"
          />
          {q.data.clusters_total > q.data.clusters.length ? <p className="nx-tg-prov">{t("Showing the first {shown} of {total}, largest first.", { shown: q.data.clusters.length, total: int(q.data.clusters_total) })}</p> : null}
        </>
      )}
    </section>
  );
}

/* ---------- survivorship ---------- */

function Survivorship({ o }: { o: ObjectRun }) {
  const q = useSurvivorship(o.module);
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Survivorship rules")} data-testid="golden-survivorship">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Survivorship rules")}</h2>
        <ItemLink kind="survivorship" id={o.module}>
          {t("Edit the rules")}
        </ItemLink>
      </div>
      {q.isPending ? (
        <Skeleton lines={2} />
      ) : q.isError ? (
        <ErrorState sentence={t("The survivorship rules could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <p className="nx-tg-prov">{t("No survivorship rule is set for this object, so a merge keeps the survivor's value for every field. Add one with Edit the rules.")}</p>
      ) : (
        <ul className="nx-tg-list" aria-label={t("Survivorship rules by field")}>
          {q.data.map((r) => (
            <li key={r.id}>
              <FieldName field={r.field} />
              <span>
                {RULE_LABEL[r.rule_type] ?? r.rule_type}
                {r.trusted_sources?.length ? `, ${r.trusted_sources.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ---------- match profile and calibration ---------- */

function MuBars({ f }: { f: CalibrationField }) {
  return (
    <span className="nx-tg-stack" aria-label={t("Agrees on {m} of true matches and {u} of non-matches", { m: pct(f.m), u: pct(f.u) })}>
      <ProgressBar value={f.m * 100} label={t("Matches")} />
      <ProgressBar value={f.u * 100} label={t("Not a duplicate")} />
      <span className="nx-num">{t("{m} and {u}", { m: pct(f.m), u: pct(f.u) })}</span>
    </span>
  );
}

function Preview({ p }: { p: TuningPreview }) {
  return (
    <p className="nx-tg-finding">
      {t("With the recommended weights, {linked} of {pairs} pairs would newly link and {unlinked} would unlink; {merge} clusters would merge and {split} would split ({before} clusters become {after}).", {
        linked: int(p.pairs_newly_linked),
        pairs: int(p.pairs),
        unlinked: int(p.pairs_unlinked),
        merge: int(p.clusters_that_would_merge),
        split: int(p.clusters_that_would_split),
        before: int(p.clusters_before),
        after: int(p.clusters_after),
      })}
    </p>
  );
}

function MatchProfile({ o }: { o: ObjectRun }) {
  const q = useMatchCalibration(o.module);
  const qc = useQueryClient();
  const toast = useToast();
  const can = useV2Session().can("approve");
  const { busy, run } = useSubmitGuard();
  const [reason, setReason] = useState("");
  if (q.isError) return null;
  if (q.isPending) return <Skeleton lines={4} />;
  const c = q.data;
  const ready = c.status === "ready";
  const changes = c.fields.filter((f) => f.recommended_weight !== f.current_weight).length;
  const missing = c.missing_profile_rules.length;
  const apply = () =>
    run(async () => {
      try {
        const res = await applyMatchCalibration({ domain: o.module, reason: reason.trim(), add_profile_rules: missing > 0 });
        setReason("");
        void qc.invalidateQueries({ queryKey: mdmKeys.root });
        toast({ text: t("{n} {n, plural, one {weight} other {weights}} changed, {added} {added, plural, one {rule} other {rules}} added. The next match run uses them.", { n: res.changed.length, added: res.added.length }), tone: "good" });
      } catch (err) {
        toast({ text: errorSentence(err, t("Apply the recommended weights")), tone: "bad" });
      }
    });
  const columns: Column<CalibrationField>[] = [
    { id: "field", label: t("Field"), cell: (f) => <FieldName field={f.field} /> },
    { id: "cmp", label: t("Comparison"), cell: (f) => COMPARATOR_LABEL[f.match_type] ?? f.match_type },
    { id: "mu", label: t("Agrees on matches and non-matches"), cell: (f) => <MuBars f={f} /> },
    { id: "ev", label: t("Evidence weight"), align: "end", cell: (f) => <span className="nx-num">{f.agreement_weight.toFixed(2)}</span>, compare: (a, b) => a.agreement_weight - b.agreement_weight },
    { id: "now", label: t("Weight now"), align: "end", cell: (f) => <span className="nx-num">{f.current_weight.toFixed(2)}</span> },
    {
      id: "rec",
      label: t("Recommended"),
      align: "end",
      cell: (f) => (f.recommended_weight !== f.current_weight ? <Chip tone="warn">{f.recommended_weight.toFixed(2)}</Chip> : <span className="nx-num">{f.recommended_weight.toFixed(2)}</span>),
    },
  ];
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("Match profile and calibration")} data-testid="golden-match-profile">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("Match profile and calibration")}</h2>
        <span className="nx-tg-sub">{t("{accepted} accepted and {rejected} rejected steward decisions", { accepted: int(c.accepted), rejected: int(c.rejected) })}</span>
      </div>
      <ul className="nx-tg-list" aria-label={t("How candidate pairs are found")}>
        {c.passes.map((p) => (
          <li key={p.name}>
            <span>{PASS_KIND[p.kind] ?? p.kind}</span>
            <span className="nx-tg-sub">
              {p.fields.map((f, i) => (
                <span key={f}>
                  {i > 0 ? ", " : ""}
                  <FieldName field={f} />
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <DataTable rows={c.fields} columns={columns} rowKey={(f) => f.field} rowLabel={(f) => f.field} caption={t("Rule weights learned from steward decisions")} density="compact" />
      <p className="nx-tg-prov">{t("The bars show how often a field agrees on pairs stewards accepted (dark) and rejected (light). A field that agrees on both separates nothing and earns little weight. Evidence weight is log2 of the two shares.")}</p>
      {ready && c.preview ? (
        <Preview p={c.preview} />
      ) : !ready ? (
        <p className="nx-tg-prov">{t("Calibration needs {n} accepted and {n} rejected steward decisions. Decide more pairs above and the weights are learned from them.", { n: c.min_decisions })}</p>
      ) : null}
      {can && (ready || missing > 0) ? (
        <div className="nx-tg-form" role="group" aria-label={t("Apply the recommended weights")}>
          <input className="nx-input" aria-label={t("Reason for the change")} placeholder={t("Reason for the change")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size={32} disabled={!reason.trim() || (ready && changes === 0 && missing === 0)} loading={busy} loadingLabel={t("Applying…")} onClick={() => void apply()}>
            {t("Apply the recommended weights")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ---------- SAP consolidation pack ---------- */

type PackRow = ConsolidationPack["rows"][number];

function ConsolidationPackSection({ o }: { o: ObjectRun }) {
  const q = useConsolidationPack(o.module);
  const toast = useToast();
  const { busy, run } = useSubmitGuard();
  if (q.isError) return null;
  if (q.isPending) return <Skeleton lines={3} />;
  const p = q.data;
  const shown = p.rows.slice(0, 12);
  const download = (format: "csv" | "xlsx") =>
    run(async () => {
      try {
        const name = await downloadConsolidationPack(o.module, format);
        toast({ text: t("Saved {name}", { name }), tone: "good" });
      } catch (err) {
        toast({ text: errorSentence(err, t("The export failed.")), tone: "bad" });
      }
    });
  const valueText = (v: string | null) => (v === "{survivor}" ? t(", value is the survivor's key") : v ? t(", value {value}", { value: v }) : t(", value from your own configuration"));
  const columns: Column<PackRow>[] = [
    { id: "loser", label: t("Merged-away record"), cell: (r) => <span className="nx-mono">{shortKey(r.loser_key)}</span> },
    { id: "survivor", label: t("Survivor"), cell: (r) => <span className="nx-mono">{shortKey(r.survivor_key)}</span> },
    { id: "field", label: t("SAP field"), cell: (r) => (r.table && r.field ? <FieldName field={`${r.table}-${r.field}`} /> : (PACK_ACTION[r.action] ?? r.action)) },
    { id: "value", label: t("New value"), cell: (r) => r.value ?? t("From your configuration") },
    { id: "merged", label: t("Merged"), cell: (r) => (r.merged_at ? formatDate(r.merged_at, "date") : <Dash />) },
  ];
  return (
    <section className="nx-card nx-tg-sec" aria-label={t("SAP consolidation pack")} data-testid="golden-pack">
      <div className="nx-tg-head">
        <h2 className="nx-sec-h">{t("SAP consolidation pack")}</h2>
        <span className="nx-tg-sub">{t("{merged} merged-away records onto {survivors} survivors", { merged: int(p.merged), survivors: int(p.survivors) })}</span>
      </div>
      <ul className="nx-tg-list" aria-label={t("What the pack sets in SAP")}>
        {p.actions.map((a) => (
          <li key={`${a.table}-${a.field}-${a.action}`}>
            <FieldName field={`${a.table}-${a.field}`} />
            <span>
              {PACK_ACTION[a.action] ?? a.action}
              {valueText(a.value)}
            </span>
          </li>
        ))}
      </ul>
      {p.rows.length === 0 ? (
        <p className="nx-tg-prov">{t("No record has been merged away yet. When a steward merges a pair, the record that does not survive is listed here with what to set in SAP.")}</p>
      ) : (
        <DataTable rows={shown} columns={columns} rowKey={(r) => `${r.loser_key}-${r.table}-${r.field}-${r.action}`} rowLabel={(r) => r.loser_key} caption={t("Merged-away records and their survivors")} density="compact" />
      )}
      <div className="nx-tg-form" role="group" aria-label={t("Download the consolidation pack")}>
        <Button size={32} disabled={p.rows.length === 0} loading={busy} onClick={() => void download("xlsx")}>
          {t("Download Excel")}
        </Button>
        <Button variant="quiet" size={32} disabled={busy || p.rows.length === 0} onClick={() => void download("csv")}>
          {t("Download CSV")}
        </Button>
      </div>
      <p className="nx-tg-prov">
        {p.total_rows > shown.length ? t("Showing {shown} of {total} rows; the download holds every row. ", { shown: shown.length, total: int(p.total_rows) }) : ""}
        {t("Meridian never writes these to SAP. A status whose value is your own configuration is named without a value.")}
      </p>
    </section>
  );
}

/* ---------- the tab ---------- */

/** The Golden records tab: the pairs waiting for a steward, duplicates across systems, the golden records, how survivors are chosen, match calibration and the SAP pack. */
export function GoldenTab({ o }: { o: ObjectRun }) {
  const label = o.label;
  const [page, setPage] = useState(1);
  const q = useGoldenRecords(o.module, page);
  const rulesQ = useSurvivorship(o.module);
  const pairsQ = useMatchPairs(o.module, 5);
  const acrossQ = useAcrossSystems(o.module);
  const { openItem } = useOpenItem();
  const dom = useMemo(() => dominantRule(rulesQ.data ?? []), [rulesQ.data]);
  const rows = useMemo(() => (q.data?.records ?? []) as GoldenRow[], [q.data]);
  const total = q.data?.total ?? 0;

  if (q.isError) return <ErrorState sentence={t("The golden records of {label} could not be read.", { label })} error={q.error} onRetry={() => void q.refetch()} />;
  const pairsWaiting = pairsQ.data?.bands.review ?? 0;
  if (!q.isPending && total === 0 && !pairsQ.isPending && pairsWaiting === 0) {
    return (
      <EmptyState icon="info" heading={t("Golden records")}>
        {t("No golden records for {label} yet. A match run groups the records that describe the same thing, scores each pair, and a steward approves the survivor; the golden records and the pairs to review land here.", { label })}
      </EmptyState>
    );
  }
  const columns: Column<GoldenRow>[] = [
    { id: "key", label: t("Golden key"), cell: (r) => <span className="nx-mono">{r.sap_object_key}</span>, compare: (a, b) => a.sap_object_key.localeCompare(b.sap_object_key) },
    { id: "name", label: t("Name"), cell: (r) => r.name || <Dash why={t("The golden records list does not carry the name; open the record")} /> },
    { id: "sources", label: t("Sources"), align: "end", cell: (r) => <span className="nx-num">{int(r.source_count)}</span>, compare: (a, b) => a.source_count - b.source_count },
    { id: "rule", label: t("Survivorship"), cell: () => (dom ? <span title={dom.title}>{dom.text}</span> : <Dash why={t("No survivorship rule is set for this object")} />) },
    { id: "confidence", label: t("Confidence"), align: "end", cell: (r) => <span className="nx-num">{confidencePct(r.overall_confidence)}</span>, compare: (a, b) => a.overall_confidence - b.overall_confidence },
    { id: "merged", label: t("Last merged"), cell: (r) => formatDate(r.updated_at, "date") },
    { id: "conflicts", label: t("Open conflicts"), align: "end", cell: (r) => <span className="nx-num">{int(r.pending_issues)}</span>, compare: (a, b) => a.pending_issues - b.pending_issues },
  ];
  const from = (page - 1) * GOLDEN_PAGE + 1;
  const to = Math.min(total, page * GOLDEN_PAGE);
  return (
    <div className="nx-tg" data-testid="tab-golden">
      <div className="nx-tg-stats">
        <StatCard label={t("Golden records")} value={total} />
        <StatCard label={t("Pairs to review")} value={pairsWaiting} />
        <StatCard label={t("Clusters across systems")} value={acrossQ.data?.clusters_total ?? 0} />
      </div>
      <Candidates o={o} />
      <AcrossSystems o={o} />
      <section className="nx-card nx-tg-sec" aria-label={t("Golden records")}>
        <div className="nx-tg-head">
          <h2 className="nx-sec-h">{t("Golden records")}</h2>
          {q.data ? <span className="nx-tg-sub">{t("{total} {total2, plural, one {record} other {records}}", { total: int(total), total2: total })}</span> : null}
        </div>
        <ExportTable><DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowLabel={(r) => r.sap_object_key}
          caption={t("Golden records of {label}", { label })}
          loading={q.isPending}
          empty={{ heading: t("Golden records"), text: t("No golden record yet for {label}. The pairs above become golden records when a steward merges them.", { label }) }}
          onOpenRow={(r) => openItem({ kind: "golden", id: r.id })}
          density="compact"
        /></ExportTable>
        {total > GOLDEN_PAGE ? (
          <div className="nx-tg-row">
            <span className="nx-tg-sub">{t("{from} to {to} of {total}", { from: int(from), to: int(to), total: int(total) })}</span>
            <Button variant="quiet" size={32} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t("Previous")}
            </Button>
            <Button variant="quiet" size={32} disabled={to >= total} onClick={() => setPage((p) => p + 1)}>
              {t("Next")}
            </Button>
          </div>
        ) : null}
        <p className="nx-tg-prov">{t("Confidence is the match engine's score for the surviving record. Last merged is when the record last changed. Open conflicts are fields where the sources disagree and no rule has settled it.")}</p>
      </section>
      <Survivorship o={o} />
      <MatchProfile o={o} />
      <ConsolidationPackSection o={o} />
    </div>
  );
}
