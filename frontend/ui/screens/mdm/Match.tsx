"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { applyMatchCalibration, downloadConsolidationPack, markNotDuplicate, mergePair, proposeMerges } from "@/lib/api/v2/mdm";
import type { ReviewPair } from "@/lib/api/match-review";
import { bulkMergePairs, clearPairConstraint, getPairConstraints, matchTuningDryRun } from "@/lib/api/v2/mdm-extra";
import { describeField } from "@/lib/v2/sap-fields";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useAcrossSystems, useConsolidationPack, useMatchCalibration, useMatchPairs } from "@/lib/v2/mdm-queries";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, SeverityPill, Skeleton, StatTile, Tabs, useAletheia, useAletheiaScope, ExportMenu } from "@/ui/kit";
import { DEFAULT_DOMAIN, DomainSelect, day, pct, useAct, useHref } from "./shared";

type Tab = "review" | "clusters" | "constraints" | "tuning" | "pack";
type Pending = null | { kind: "merge" | "dismiss"; pair: ReviewPair } | { kind: "bulk" } | { kind: "propose" } | { kind: "apply" };
const BAND_SEV = { auto_merge: "low", review: "medium", low: "info" } as const;

export function Match() {
  useInterfaceLang();
  const href = useHref();
  const fx = useFixture();
  const chat = useAletheia();
  const { act, busy } = useAct();
  const [domain, setDomain] = useState(DEFAULT_DOMAIN);
  const [tab, setTab] = useState<Tab>("review");
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const [minScore, setMinScore] = useState("0.9");
  const [open, setOpen] = useState<ReviewPair | null>(null);
  const [dry, setDry] = useState<Awaited<ReturnType<typeof matchTuningDryRun>> | null>(null);
  const pairs = useMatchPairs(domain, 50);
  const across = useAcrossSystems(domain);
  const cons = useQuery({ queryKey: ["v2", "mdm", "constraints", fx, domain], queryFn: () => getPairConstraints(domain), staleTime: 30_000, retry: false });
  const cal = useMatchCalibration(domain);
  const pack = useConsolidationPack(domain);
  const list = pairs.data?.pairs ?? [];
  const bands = pairs.data?.bands;
  const th = pairs.data?.thresholds;

  useAletheiaScope({
    key: `mdm-match/${domain}`,
    label: t("Asking about match review"),
    suggestions: [t("Which pairs are safe to merge?"), t("Why is this pair scored high?")],
    answer: () => ({
      text: t("{n} pairs wait for a steward. Auto-merge starts at {a} and review at {r}.", { n: pairs.data?.total ?? 0, a: th ? pct(th.auto_merge) : t("n/a"), r: th ? pct(th.review_floor) : t("n/a") }),
      evidence: list.slice(0, 3).map((p) => `${p.a} / ${p.b}: ${pct(p.total)}`),
    }),
  });

  const close = () => { setPending(null); setReason(""); };
  const why = reason.trim();
  const run = async () => {
    const p = pending;
    close();
    if (!p) return;
    if (p.kind === "merge") await act(() => mergePair(p.pair.id, { survivor: p.pair.a, overrides: {}, reason: why || t("Merged by a steward") }), t("Pair merged"));
    else if (p.kind === "dismiss") await act(() => markNotDuplicate(p.pair.id, why || t("Not a duplicate")), t("Marked as not a duplicate"));
    else if (p.kind === "bulk") await act(() => bulkMergePairs({ min_score: Number(minScore), reason: why || t("Bulk merge by a steward"), domain }), (r) => t("{n} pairs merged", { n: r.merged }));
    else if (p.kind === "propose") await act(() => proposeMerges(list.slice(0, 20).map((x, i) => ({ match_score_id: x.id, priority: i + 1 }))), (r) => t("{n} merge decisions queued", { n: r.created.length }));
    else if (p.kind === "apply") await act(() => applyMatchCalibration({ domain, reason: why || t("Calibrated from steward decisions"), add_profile_rules: true }), (r) => t("{n} weights changed", { n: r.changed.length }));
  };
  const titles: Record<NonNullable<Pending>["kind"], string> = {
    merge: t("Merge this pair?"), dismiss: t("Mark this pair as not a duplicate?"), bulk: t("Merge every pair at or above the score?"),
    propose: t("Queue merge decisions for the top pairs?"), apply: t("Apply the recommended weights?"),
  };

  return (
    <>
      <PageHeader
        title={t("Match review")}
        context={t("{n} pairs waiting", { n: pairs.data?.total ?? 0 })}
        actions={<>
          <Button variant="ghost" href={href("/mdm/match-rules")}>{t("Match rules")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      <div className="mx-col">
        <DomainSelect value={domain} onChange={setDomain} />
        <dl className="mx-tiles">
          <StatTile label={t("Auto-merge band")} value={String(bands?.auto_merge ?? 0)} note={th ? t("from {s}", { s: pct(th.auto_merge) }) : undefined} />
          <StatTile label={t("Review band")} value={String(bands?.review ?? 0)} note={th ? t("from {s}", { s: pct(th.review_floor) }) : undefined} />
          <StatTile label={t("Low band")} value={String(bands?.low ?? 0)} />
          <StatTile label={t("Cross-system clusters")} value={String(across.data?.clusters_total ?? 0)} />
        </dl>
        <Tabs
          idBase="mdm-match"
          label={t("Match review sections")}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={[
            { id: "review", label: t("Review queue"), badge: String(pairs.data?.total ?? 0) },
            { id: "clusters", label: t("Clusters"), badge: String(across.data?.clusters_total ?? 0) },
            { id: "constraints", label: t("Constraints"), badge: String(cons.data?.length ?? 0) },
            { id: "tuning", label: t("Tuning") },
            { id: "pack", label: t("Consolidation pack") },
          ]}
        />
        {tab === "review" && (
          pairs.isLoading ? <Skeleton lines={8} label={t("Loading match pairs")} /> : pairs.isError ? <ErrorState heading={t("Match pairs could not be loaded")} retryLabel={t("Try again")} onRetry={() => void pairs.refetch()} /> : list.length === 0 ? (
            <EmptyState heading={t("No pairs waiting")} body={t("Every candidate pair has a decision.")} />
          ) : (
            <>
              <Card
                title={t("Pairs for review")}
                sub={t("Select a pair to see why it scored as it did.")}
                action={<span className="mx-links">
                  <Field label={t("Minimum score")}><Input value={minScore} onChange={(e) => setMinScore(e.target.value)} inputMode="decimal" /></Field>
                  <Button variant="secondary" disabled={busy || !(Number(minScore) > 0 && Number(minScore) <= 1)} onClick={() => setPending({ kind: "bulk" })}>{t("Bulk merge")}</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setPending({ kind: "propose" })}>{t("Propose merges")}</Button>
                </span>}
              >
                <DataTable<ReviewPair>
                  label={t("Pairs for review")}
                  rows={list}
                  rowKey={(p) => p.id}
                  selected={open?.id}
                  onSelect={(p) => setOpen(p)}
                  columns={[
                    { key: "a", label: t("Record A"), render: (p) => <FieldChip code={p.a} /> },
                    { key: "b", label: t("Record B"), render: (p) => <FieldChip code={p.b} /> },
                    { key: "s", label: t("Score"), align: "end", sort: (p) => p.total, render: (p) => pct(p.total) },
                    { key: "band", label: t("Band"), render: (p) => <SeverityPill sev={BAND_SEV[p.band]} label={p.band === "auto_merge" ? t("Auto-merge") : p.band === "review" ? t("Review") : t("Low")} /> },
                    { key: "c", label: t("Constraint"), render: (p) => p.constraint ?? "" },
                    {
                      key: "x", label: t("Decision"), render: (p) => p.same_cluster ? t("Already merged") : (
                        <span className="mx-links">
                          <Button variant="primary" disabled={busy} onClick={() => setPending({ kind: "merge", pair: p })}>{t("Merge")}</Button>
                          <Button variant="ghost" disabled={busy} onClick={() => setPending({ kind: "dismiss", pair: p })}>{t("Not a duplicate")}</Button>
                          {p.a_record_id ? <Button variant="ghost" href={href(`/mdm/match/${p.a_record_id}`)}>{t("Cluster")}</Button> : null}
                        </span>
                      ),
                    },
                  ]}
                />
              </Card>
              {open && (
                <Card title={t("Why {a} and {b} scored {s}", { a: open.a, b: open.b, s: pct(open.total) })} sub={open.explanation ? t("Rule fired: {r}", { r: open.explanation.fired }) : undefined}>
                  {open.explanation ? (
                    <DataTable
                      label={t("Score by field")}
                      rows={open.explanation.attributes}
                      rowKey={(x) => x.field}
                      columns={[
                        { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.field} description={describeField(x.field) ?? undefined} /> },
                        { key: "a", label: t("Value A"), render: (x) => x.value_a },
                        { key: "b", label: t("Value B"), render: (x) => x.value_b },
                        { key: "sim", label: t("Similarity"), align: "end", render: (x) => (x.similarity === null ? t("n/a") : pct(x.similarity)) },
                        { key: "w", label: t("Weight"), align: "end", render: (x) => x.weight },
                        { key: "c", label: t("Contribution"), align: "end", render: (x) => x.contribution },
                      ]}
                    />
                  ) : <EmptyState heading={t("No explanation stored for this pair")} body={t("Run matching again to store why these two records match.")} />}
                </Card>
              )}
            </>
          )
        )}
        {tab === "clusters" && (
          <Card title={t("Cross-system clusters")} sub={t("Duplicates whose records sit in different connected systems.")}>
            {across.isError ? <ErrorState heading={t("Cross-system clusters could not be loaded")} retryLabel={t("Try again")} onRetry={() => void across.refetch()} /> : (across.data?.clusters ?? []).length === 0 ? <EmptyState heading={t("No cross-system clusters")} body={t("Run matching on at least two systems to find clusters across them.")} /> : (
              <DataTable
                label={t("Cross-system clusters")}
                rows={across.data?.clusters ?? []}
                rowKey={(c) => c.id}
                columns={[
                  { key: "m", label: t("Records"), render: (c) => c.members.map((m) => m.key).join(", ") },
                  { key: "s", label: t("Systems"), render: (c) => Array.from(new Set(c.members.map((m) => m.system_name ?? m.system_id ?? ""))).join(", ") },
                  { key: "p", label: t("Pairs"), align: "end", render: (c) => c.pairs },
                  { key: "b", label: t("Best score"), align: "end", sort: (c) => c.best, render: (c) => pct(c.best) },
                  { key: "st", label: t("State"), render: (c) => (c.merged ? t("Merged") : t("Open")) },
                  { key: "g", label: t("Graph"), render: (c) => { const g = c.members.find((m) => m.golden_record_id)?.golden_record_id; return g ? <Button variant="ghost" href={href(`/mdm/match/${g}`)}>{t("Open graph")}</Button> : ""; } },
                ]}
              />
            )}
          </Card>
        )}
        {tab === "constraints" && (
          <Card title={t("Pair constraints")} sub={t("Pairs a steward decided. Clear one to offer it again.")}>
            {cons.isError ? <ErrorState heading={t("Pair constraints could not be loaded")} retryLabel={t("Try again")} onRetry={() => void cons.refetch()} /> : (cons.data ?? []).length === 0 ? <EmptyState heading={t("No pair constraints")} body={t("Add a must-link or cannot-link to control how two records match.")} /> : (
              <DataTable
                label={t("Pair constraints")}
                rows={cons.data ?? []}
                rowKey={(c) => c.id}
                columns={[
                  { key: "a", label: t("Record A"), render: (c) => <FieldChip code={c.key_lo} /> },
                  { key: "b", label: t("Record B"), render: (c) => <FieldChip code={c.key_hi} /> },
                  { key: "k", label: t("Kind"), render: (c) => c.kind },
                  { key: "r", label: t("Reason"), render: (c) => c.reason ?? "" },
                  { key: "d", label: t("Decided"), render: (c) => day(c.created_at) },
                  { key: "x", label: t("Action"), render: (c) => <Button variant="ghost" disabled={busy} onClick={() => act(() => clearPairConstraint(c.id), t("Constraint cleared"))}>{t("Clear")}</Button> },
                ]}
              />
            )}
          </Card>
        )}
        {tab === "tuning" && (
          <>
            <Card
              title={t("Calibration from steward decisions")}
              sub={cal.data ? t("{a} accepted and {r} rejected decisions. At least {m} are needed.", { a: cal.data.accepted, r: cal.data.rejected, m: cal.data.min_decisions }) : undefined}
              action={<Button variant="secondary" disabled={busy || cal.data?.status !== "ready"} onClick={() => setPending({ kind: "apply" })}>{t("Apply recommended weights")}</Button>}
            >
              {cal.isLoading ? <Skeleton lines={4} label={t("Loading calibration")} /> : cal.isError ? <ErrorState heading={t("Calibration could not be loaded")} retryLabel={t("Try again")} onRetry={() => void cal.refetch()} /> :  (cal.data?.fields ?? []).length === 0 ? <EmptyState heading={t("No calibration data yet")} body={t("Decide more pairs so Meridian can learn the weights.")} /> : (
                <DataTable
                  label={t("Calibration by field")}
                  rows={cal.data?.fields ?? []}
                  rowKey={(x) => x.field}
                  columns={[
                    { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.field} description={describeField(x.field) ?? undefined} /> },
                    { key: "m", label: t("Agrees when same"), align: "end", render: (x) => pct(x.m) },
                    { key: "u", label: t("Agrees when different"), align: "end", render: (x) => pct(x.u) },
                    { key: "c", label: t("Weight now"), align: "end", render: (x) => x.current_weight },
                    { key: "r", label: t("Recommended"), align: "end", render: (x) => x.recommended_weight },
                  ]}
                />
              )}
            </Card>
            <Card title={t("Dry run")} sub={t("Show what the current settings would do to every pair. Nothing is saved.")} action={<Button variant="secondary" disabled={busy} onClick={async () => { await act(async () => { const r = await matchTuningDryRun({ domain, auto_merge: th?.auto_merge, review_floor: th?.review_floor }); setDry(r); return r; }, t("Dry run finished")); }}>{t("Run dry run")}</Button>}>
              {dry ? (
                <dl className="mx-tiles">
                  <StatTile label={t("Pairs newly linked")} value={String(dry.pairs_newly_linked)} />
                  <StatTile label={t("Pairs unlinked")} value={String(dry.pairs_unlinked)} />
                  <StatTile label={t("Clusters before")} value={String(dry.clusters_before)} />
                  <StatTile label={t("Clusters after")} value={String(dry.clusters_after)} />
                </dl>
              ) : <p className="mx-muted">{t("Run the dry run to see the effect.")}</p>}
            </Card>
          </>
        )}
        {tab === "pack" && (
          <Card
            title={t("Consolidation pack")}
            sub={pack.data ? t("{m} merged records into {s} survivors.", { m: pack.data.merged, s: pack.data.survivors }) : undefined}
            action={<span className="mx-links">
              <ExportMenu label={t("Download pack")} disabled={busy} formats={[{ id: "xlsx", label: t("Excel workbook") }, { id: "csv", label: t("CSV") }]} onExport={(f) => downloadConsolidationPack(domain, f as "csv" | "xlsx")} />
            </span>}
          >
            {pack.isError ? <ErrorState heading={t("The consolidation pack could not be loaded")} retryLabel={t("Try again")} onRetry={() => void pack.refetch()} /> : (pack.data?.rows ?? []).length === 0 ? <EmptyState heading={t("Nothing merged yet")} body={t("The pack lists the records that retire once pairs are merged.")} /> : (
              <DataTable
                label={t("Consolidation pack")}
                rows={(pack.data?.rows ?? []).map((r, i) => ({ ...r, i }))}
                rowKey={(r) => String(r.i)}
                columns={[
                  { key: "l", label: t("Retired record"), render: (r) => <FieldChip code={r.loser_key} /> },
                  { key: "s", label: t("Survivor"), render: (r) => <FieldChip code={r.survivor_key} /> },
                  { key: "t", label: t("Table"), render: (r) => r.table ?? "" },
                  { key: "f", label: t("Field"), render: (r) => (r.field ? <FieldChip code={r.field} description={describeField(r.field) ?? undefined} /> : "") },
                  { key: "a", label: t("Action"), render: (r) => r.action },
                ]}
              />
            )}
          </Card>
        )}
      </div>
      <Confirm
        open={pending !== null}
        title={pending ? titles[pending.kind] : ""}
        confirmLabel={t("Confirm")}
        cancelLabel={t("Cancel")}
        danger={pending?.kind === "merge" || pending?.kind === "bulk"}
        onConfirm={run}
        onCancel={close}
      >
        <Field label={t("Reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>
    </>
  );
}
